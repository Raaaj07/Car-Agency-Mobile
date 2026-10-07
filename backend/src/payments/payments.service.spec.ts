import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { PaymentEntity } from './entities/payment.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { PaymentProvider } from './providers/payment-provider.interface';

/**
 * P-1 state machine (pending → rider_claimed → paid | disputed) and
 * P-2 idempotency/amount checks.
 */
describe('PaymentsService', () => {
  let service: PaymentsService;
  let payments: Record<string, jest.Mock>;
  let rides: Record<string, jest.Mock>;
  let provider: Record<string, jest.Mock>;

  const rideFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    riderId: 'u1',
    status: 'completed',
    paymentStatus: 'pending',
    paymentMethod: 'upi',
    fareBreakdown: { baseFare: 100, distanceFare: 80, timeCharge: 32, tollFee: 0, taxes: 28, discount: 0, total: 240 },
    tipAmount: 0,
    ...overrides,
  });

  beforeEach(() => {
    payments = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (p) => ({ id: 'pay-1', ...p })),
      create: jest.fn((p) => p),
    };
    rides = {
      findOne: jest.fn().mockResolvedValue(rideFixture()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    provider = {
      createOrder: jest.fn().mockResolvedValue({ orderId: 'order_1', amount: 240, currency: 'INR', providerKey: 'rzp_key' }),
      verifyPayment: jest.fn().mockResolvedValue(true),
      providerKey: jest.fn().mockReturnValue('rzp_key'),
    };

    service = new PaymentsService(
      payments as unknown as Repository<PaymentEntity>,
      rides as unknown as Repository<RideEntity>,
      provider as unknown as PaymentProvider,
    );
  });

  describe('createOrder — cash claim (P-1)', () => {
    it('only reaches rider_claimed, never paid', async () => {
      const result = await service.createOrder('u1', { rideId: 'r1', method: 'cash' });

      expect(result.status).toBe('rider_claimed');
      expect(rides.update).toHaveBeenCalledWith(
        { id: 'r1' },
        { paymentMethod: 'cash', paymentStatus: 'rider_claimed', paymentMarkedBy: 'rider' },
      );
      // The rider claim must never settle the ride on its own.
      const updatePayload = rides.update.mock.calls[0][1] as Record<string, unknown>;
      expect(updatePayload.paymentStatus).not.toBe('paid');
    });

    it('reuses the deterministic cash order instead of duplicating rows', async () => {
      payments.findOne.mockResolvedValue({
        providerOrderId: 'cash_r1',
        status: 'pending',
        amount: 240,
      });

      const result = await service.createOrder('u1', { rideId: 'r1', method: 'cash' });

      expect(payments.create).not.toHaveBeenCalled();
      expect(result.orderId).toBe('cash_r1');
      expect(result.status).toBe('rider_claimed');
    });

    it('refuses when the ride is already paid', async () => {
      rides.findOne.mockResolvedValue(rideFixture({ paymentStatus: 'paid' }));

      await expect(service.createOrder('u1', { rideId: 'r1', method: 'cash' })).rejects.toThrow(
        ConflictException,
      );
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('refuses when the ride is disputed', async () => {
      rides.findOne.mockResolvedValue(rideFixture({ paymentStatus: 'disputed' }));

      await expect(service.createOrder('u1', { rideId: 'r1', method: 'cash' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a non-owner', async () => {
      await expect(service.createOrder('someone-else', { rideId: 'r1', method: 'cash' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects before completion', async () => {
      rides.findOne.mockResolvedValue(rideFixture({ status: 'in_progress' }));

      await expect(service.createOrder('u1', { rideId: 'r1', method: 'cash' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createOrder — gateway path (P-2 idempotency)', () => {
    it('reuses an existing pending order instead of minting a duplicate', async () => {
      payments.findOne.mockResolvedValue({
        providerOrderId: 'order_existing',
        amount: 240,
        status: 'pending',
      });

      const result = await service.createOrder('u1', { rideId: 'r1', method: 'upi' });

      expect(provider.createOrder).not.toHaveBeenCalled();
      expect(payments.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ orderId: 'order_existing', status: 'pending', providerKey: 'rzp_key' });
    });

    it('creates one order when none is pending', async () => {
      const result = await service.createOrder('u1', { rideId: 'r1', method: 'upi' });

      expect(provider.createOrder).toHaveBeenCalledWith(240, 'r1');
      expect(payments.create).toHaveBeenCalledWith(
        expect.objectContaining({ rideId: 'r1', providerOrderId: 'order_1', status: 'pending' }),
      );
      expect(result.status).toBe('pending');
    });
  });

  describe('verify (P-1/P-2)', () => {
    it('settles the ride only after signature verification, marked by provider', async () => {
      payments.findOne.mockResolvedValue({ id: 'pay-1', amount: 240, status: 'pending' });

      const result = await service.verify('u1', { rideId: 'r1', orderId: 'order_1' });

      expect(provider.verifyPayment).toHaveBeenCalled();
      expect(rides.update).toHaveBeenCalledWith(
        { id: 'r1' },
        { paymentStatus: 'paid', paymentMarkedBy: 'provider' },
      );
      expect(result).toMatchObject({ paid: true, total: 240, receiptId: 'pay-1' });
    });

    it('rejects an order whose amount does not match the ride fare', async () => {
      payments.findOne.mockResolvedValue({ id: 'pay-1', amount: 999, status: 'pending' });

      await expect(service.verify('u1', { rideId: 'r1', orderId: 'order_1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(provider.verifyPayment).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('is idempotent for an already-paid order', async () => {
      rides.findOne.mockResolvedValue(rideFixture({ paymentStatus: 'paid' }));
      payments.findOne.mockResolvedValue({ id: 'pay-1', amount: 240, status: 'paid' });

      const result = await service.verify('u1', { rideId: 'r1', orderId: 'order_1' });

      expect(result.paid).toBe(true);
      expect(provider.verifyPayment).not.toHaveBeenCalled();
    });

    it('marks failed and does not settle the ride on a bad signature', async () => {
      payments.findOne.mockResolvedValue({ id: 'pay-1', amount: 240, status: 'pending' });
      provider.verifyPayment.mockResolvedValue(false);

      await expect(service.verify('u1', { rideId: 'r1', orderId: 'order_1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(payments.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('404s on an unknown order', async () => {
      payments.findOne.mockResolvedValue(null);

      await expect(service.verify('u1', { rideId: 'r1', orderId: 'nope' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to verify a cash order through the gateway (rider cannot self-settle)', async () => {
      payments.findOne.mockResolvedValue({
        id: 'pay-1',
        method: 'cash',
        providerOrderId: 'cash_r1',
        amount: 240,
        status: 'rider_claimed',
      });

      await expect(service.verify('u1', { rideId: 'r1', orderId: 'cash_r1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(provider.verifyPayment).not.toHaveBeenCalled();
      expect(payments.save).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });
  });
});
