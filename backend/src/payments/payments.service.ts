import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { PaymentEntity } from './entities/payment.entity';
import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment-provider.interface';

/**
 * Payment state machine (P-1), single source of truth on `rides.paymentStatus`:
 *
 *   pending ──rider claims cash/UPI-QR──▶ rider_claimed ──driver "Amount Received"/admin──▶ paid
 *        └──gateway verify (signature ok)──────────────────────────────────────────────▶ paid
 *        └──gateway verify fail──▶ failed            admin dispute ──▶ disputed (admin-only)
 *
 * A rider claim NEVER settles the ride; only the driver's confirmation, an
 * admin resolution, or a Razorpay signature-verified payment does — and each
 * path records `rides.paymentMarkedBy` (rider|driver|admin|provider).
 * Amounts are integer rupees end-to-end (fare totals are whole rupees).
 */
@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // POST /payments/create-order — a rider *claim* of payment (cash/UPI-QR) or
  // a gateway order (upi/wallet/card). Never flips the ride to 'paid'.
  async createOrder(riderId: string, dto: CreateOrderDto) {
    const ride = await this.getRideForRider(dto.rideId, riderId);
    if (ride.status !== 'completed') {
      throw new BadRequestException('Ride must be completed before payment');
    }
    if (ride.paymentStatus === 'paid') {
      throw new ConflictException('Payment is already settled for this ride');
    }
    if (ride.paymentStatus === 'disputed') {
      throw new ConflictException('Payment is disputed — an admin must resolve it first');
    }

    const amount = ride.fareBreakdown.total + (ride.tipAmount ?? 0);

    if (dto.method === 'cash') {
      // P-1: the rider's claim only reaches rider_claimed — the driver's
      // "Amount Received" (or an admin) is what settles it.
      // P-2 idempotency: one deterministic cash order per ride (also what the
      // unique (rideId, providerOrderId) index enforces).
      const orderId = `cash_${ride.id}`;
      let payment = await this.payments.findOne({ where: { rideId: ride.id, providerOrderId: orderId } });
      if (!payment) {
        payment = await this.payments.save(
          this.payments.create({
            rideId: ride.id,
            method: 'cash',
            amount,
            providerOrderId: orderId,
            status: 'rider_claimed',
          }),
        );
      } else if (payment.status === 'pending') {
        payment.status = 'rider_claimed';
        payment = await this.payments.save(payment);
      }
      await this.rides.update(
        { id: ride.id },
        { paymentMethod: 'cash', paymentStatus: 'rider_claimed', paymentMarkedBy: 'rider' },
      );
      return {
        orderId: payment.providerOrderId,
        amount: payment.amount,
        currency: 'INR',
        providerKey: '',
        status: 'rider_claimed' as const,
      };
    }

    // P-2 idempotency: reuse the ride's existing pending gateway order instead
    // of minting a duplicate row (and provider order) on every call.
    const existing = await this.payments.findOne({
      where: { rideId: ride.id, method: dto.method, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
    if (existing?.providerOrderId) {
      return {
        orderId: existing.providerOrderId,
        amount: existing.amount,
        currency: 'INR',
        providerKey: this.provider.providerKey(),
        status: 'pending' as const,
      };
    }

    const order = await this.provider.createOrder(amount, ride.id);
    await this.payments.save(
      this.payments.create({
        rideId: ride.id,
        method: dto.method,
        amount,
        providerOrderId: order.orderId,
        status: 'pending',
      }),
    );
    await this.rides.update({ id: ride.id }, { paymentMethod: dto.method });

    return { ...order, status: 'pending' as const };
  }

  // POST /payments/verify — signature check settles the ride (provider path).
  // P-2: the amount that was ordered must match the ride's fare (tip may have
  // been added after ordering, so it is an upper bound only), and a repeat
  // verify of an already-paid order is idempotent.
  async verify(riderId: string, dto: VerifyPaymentDto) {
    const ride = await this.getRideForRider(dto.rideId, riderId);
    const payment = await this.payments.findOne({
      where: { rideId: ride.id, providerOrderId: dto.orderId },
      order: { createdAt: 'DESC' },
    });
    if (!payment) {
      throw new NotFoundException('Payment order not found');
    }
    if (ride.paymentStatus === 'disputed') {
      throw new ConflictException('Payment is disputed — an admin must resolve it first');
    }
    if (payment.status === 'paid' || ride.paymentStatus === 'paid') {
      // Idempotent: double-tap / retry after success.
      return {
        paid: true,
        total: ride.fareBreakdown.total + (ride.tipAmount ?? 0),
        receiptId: payment.id,
      };
    }

    const total = ride.fareBreakdown.total;
    if (payment.amount < total || payment.amount > total + (ride.tipAmount ?? 0)) {
      throw new BadRequestException(
        `Order amount ₹${payment.amount} does not match ride fare ₹${total}`,
      );
    }

    const verified = await this.provider.verifyPayment({
      orderId: dto.orderId,
      paymentId: dto.paymentId ?? '',
      signature: dto.signature ?? '',
    });

    payment.status = verified ? 'paid' : 'failed';
    payment.providerPaymentId = dto.paymentId ?? null;
    await this.payments.save(payment);

    if (!verified) {
      throw new BadRequestException('Payment verification failed');
    }

    await this.rides.update(
      { id: ride.id },
      { paymentStatus: 'paid', paymentMarkedBy: 'provider' },
    );
    // Include tip so receipt matches what was charged (total + tip).
    return { paid: true, total: ride.fareBreakdown.total + (ride.tipAmount ?? 0), receiptId: payment.id };
  }

  private async getRideForRider(rideId: string, riderId: string): Promise<RideEntity> {
    const ride = await this.rides.findOne({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== riderId) {
      throw new ForbiddenException('Not your ride');
    }
    return ride;
  }
}
