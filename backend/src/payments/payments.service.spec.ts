import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { RazorpayWebhookDto } from './dto/razorpay-webhook.dto';
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
  let config: Record<string, jest.Mock>;
  // Ride-row lock stub: PaymentsService.withRideLock runs through
  // rides.manager.connection.createQueryRunner(). The manager re-reads
  // through the SAME per-test repo mocks so per-test overrides keep working.
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: Record<string, jest.Mock>;
  };

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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        findOne: jest.fn((entity: unknown, opts?: unknown) =>
          entity === RideEntity ? rides.findOne(opts) : payments.findOne(opts),
        ),
        save: jest.fn((row: Record<string, unknown>) => payments.save(row)),
        create: jest.fn((_entity: unknown, data: Record<string, unknown>) => payments.create(data)),
        update: jest.fn((entity: unknown, where: unknown, partial: unknown) =>
          entity === RideEntity ? rides.update(where, partial) : payments.update(where, partial),
        ),
      },
    };
    rides = {
      findOne: jest.fn().mockResolvedValue(rideFixture()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: Object.assign(jest.fn(), {
        connection: { createQueryRunner: jest.fn(() => queryRunner) },
      }),
    };
    provider = {
      createOrder: jest.fn().mockResolvedValue({ orderId: 'order_1', amount: 240, currency: 'INR', providerKey: 'rzp_key' }),
      verifyPayment: jest.fn().mockResolvedValue(true),
      providerKey: jest.fn().mockReturnValue('rzp_key'),
    };
    config = {
      get: jest.fn((key: string) => (key === 'RAZORPAY_WEBHOOK_SECRET' ? 'whsec_test_fake' : undefined)),
    };

    service = new PaymentsService(
      payments as unknown as Repository<PaymentEntity>,
      rides as unknown as Repository<RideEntity>,
      provider as unknown as PaymentProvider,
      config as unknown as ConfigService,
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

  // Pass-4 (task 5): signature-verified gateway → server settlement.
  describe('Razorpay webhook', () => {
    const SECRET = 'whsec_test_fake'; // obvious fake — never a real secret
    const sign = (body: Buffer, secret: string): string =>
      createHmac('sha256', secret).update(body).digest('hex');

    const eventFor = (event: string, payload: Record<string, unknown>): RazorpayWebhookDto => ({
      event,
      payload,
    });

    /** Build the raw body from the DTO and deliver it with a chosen signature. */
    const deliver = (
      dto: RazorpayWebhookDto,
      opts: { signature?: string } = {},
    ): Promise<{ received: true }> => {
      const body = Buffer.from(JSON.stringify(dto), 'utf8');
      const signature = opts.signature ?? sign(body, SECRET);
      return service.handleRazorpayWebhook(body, signature, dto);
    };

    const captureEvent = () =>
      eventFor('payment.captured', {
        payment: {
          entity: {
            id: 'pay_rzp_fake',
            order_id: 'order_1',
            // Phase-2.1: the signed payload is authoritative (paise/INR/captured).
            amount: 24_000,
            currency: 'INR',
            status: 'captured',
          },
        },
      });

    /** Same event with one signed field overridden (mismatch cases). */
    const captureEventWith = (entity: Record<string, unknown>) =>
      eventFor('payment.captured', {
        payment: {
          entity: {
            id: 'pay_rzp_fake',
            order_id: 'order_1',
            amount: 24_000,
            currency: 'INR',
            status: 'captured',
            ...entity,
          },
        },
      });
    const pendingCapture = () =>
      payments.findOne.mockResolvedValue({
        id: 'pay-1',
        rideId: 'r1',
        providerOrderId: 'order_1',
        method: 'upi',
        amount: 240,
        status: 'pending',
      });

    it('settles payment + ride on a valid signature (payment.captured)', async () => {
      pendingCapture();

      const result = await deliver(captureEvent());

      expect(result).toEqual({ received: true });
      expect(payments.update).toHaveBeenCalledWith(
        { id: 'pay-1' },
        { status: 'paid', providerPaymentId: 'pay_rzp_fake' },
      );
      expect(rides.update).toHaveBeenCalledWith(
        { id: 'r1' },
        { paymentStatus: 'paid', paymentMarkedBy: 'provider' },
      );
    });

    it('rejects an invalid signature with 401 and settles nothing', async () => {
      pendingCapture();

      await expect(deliver(captureEvent(), { signature: 'f'.repeat(64) })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(payments.update).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('fails closed with 401 when the webhook secret is not configured', async () => {
      config.get.mockImplementation(() => undefined);
      pendingCapture();

      await expect(deliver(captureEvent())).rejects.toThrow(UnauthorizedException);
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('rejects a delivery with no signature header', async () => {
      const body = Buffer.from('{}', 'utf8');
      await expect(service.handleRazorpayWebhook(body, undefined, captureEvent())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('a replayed delivery is idempotent (already-settled ride)', async () => {
      payments.findOne.mockResolvedValue({
        id: 'pay-1',
        rideId: 'r1',
        providerOrderId: 'order_1',
        method: 'upi',
        amount: 240,
        status: 'paid',
      });
      rides.findOne.mockResolvedValue(rideFixture({ paymentStatus: 'paid' }));

      const result = await deliver(captureEvent());

      expect(result).toEqual({ received: true });
      expect(payments.update).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('rejects an amount mismatch instead of settling', async () => {
      payments.findOne.mockResolvedValue({
        id: 'pay-1',
        rideId: 'r1',
        providerOrderId: 'order_1',
        method: 'upi',
        amount: 999,
        status: 'pending',
      });

      // Signed amount matches OUR stored order (999 * 100) so the new
      // Phase-2.1 gate passes; the existing amount-vs-FARE gate must still
      // reject this tampered order with a 400.
      await expect(deliver(captureEventWith({ amount: 99_900 }))).rejects.toThrow(
        BadRequestException,
      );
      expect(payments.update).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('acks unknown events with 200 without touching state', async () => {
      const result = await deliver(eventFor('payment.failed', {}));

      expect(result).toEqual({ received: true });
      expect(payments.findOne).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    // Phase-2.1: the signed payload must describe the money we ordered.
    it('acks but does NOT settle when the captured amount differs from our order', async () => {
      pendingCapture();

      const result = await deliver(captureEventWith({ amount: 23_999 }));

      expect(result).toEqual({ received: true });
      expect(payments.update).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('acks but does NOT settle for a non-INR currency', async () => {
      pendingCapture();

      const result = await deliver(captureEventWith({ currency: 'USD' }));

      expect(result).toEqual({ received: true });
      expect(payments.update).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('acks but does NOT settle an authorized (not captured) payment', async () => {
      pendingCapture();

      const result = await deliver(captureEventWith({ status: 'authorized' }));

      expect(result).toEqual({ received: true });
      expect(payments.update).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('does not settle when the signed payload omits amount/currency/status', async () => {
      pendingCapture();

      const result = await deliver(
        eventFor('payment.captured', {
          payment: { entity: { id: 'pay_rzp_fake', order_id: 'order_1' } },
        }),
      );

      expect(result).toEqual({ received: true });
      expect(rides.update).not.toHaveBeenCalled();
    });
  });
});
