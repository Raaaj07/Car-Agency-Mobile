import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { EntityManager, QueryRunner, Repository } from 'typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { RazorpayWebhookDto } from './dto/razorpay-webhook.dto';
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
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly config: ConfigService,
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

    // Pass-4 (task 5): the whole "existing pending order or create" section
    // runs under a pessimistic lock on the ride row, so two concurrent taps
    // serialize here — the loser re-reads `payments` UNDER the lock and
    // reuses the winner's order instead of minting a duplicate gateway order
    // (or a duplicate cash row that would collide on the unique index).
    return this.withRideLock(ride.id, async (lockedRide, manager) => {
      // Re-validate on the LOCKED row: the payment may have settled (driver
      // "Amount Received", admin, gateway verify) while we waited for it.
      if (lockedRide.paymentStatus === 'paid') {
        throw new ConflictException('Payment is already settled for this ride');
      }
      if (lockedRide.paymentStatus === 'disputed') {
        throw new ConflictException('Payment is disputed — an admin must resolve it first');
      }
      const amount = lockedRide.fareBreakdown.total + (lockedRide.tipAmount ?? 0);

      if (dto.method === 'cash') {
        // P-1: the rider's claim only reaches rider_claimed — the driver's
        // "Amount Received" (or an admin) is what settles it.
        // P-2 idempotency: one deterministic cash order per ride (also what the
        // unique (rideId, providerOrderId) index enforces).
        const orderId = `cash_${lockedRide.id}`;
        let payment = await manager.findOne(PaymentEntity, {
          where: { rideId: lockedRide.id, providerOrderId: orderId },
        });
        if (!payment) {
          payment = await manager.save(
            manager.create(PaymentEntity, {
              rideId: lockedRide.id,
              method: 'cash',
              amount,
              providerOrderId: orderId,
              status: 'rider_claimed',
            }),
          );
        } else if (payment.status === 'pending') {
          payment.status = 'rider_claimed';
          payment = await manager.save(payment);
        }
        await manager.update(
          RideEntity,
          { id: lockedRide.id },
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

      // P-2 idempotency: reuse the ride's existing pending gateway order
      // instead of minting a duplicate row (and provider order) on every call.
      // This is exactly the check-then-insert the row lock exists to serialize.
      const existing = await manager.findOne(PaymentEntity, {
        where: { rideId: lockedRide.id, method: dto.method, status: 'pending' },
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

      const order = await this.provider.createOrder(amount, lockedRide.id);
      await manager.save(
        manager.create(PaymentEntity, {
          rideId: lockedRide.id,
          method: dto.method,
          amount,
          providerOrderId: order.orderId,
          status: 'pending',
        }),
      );
      await manager.update(RideEntity, { id: lockedRide.id }, { paymentMethod: dto.method });

      return { ...order, status: 'pending' as const };
    });
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
    // P-1: a cash order is only ever settled by the driver's "Amount Received"
    // or an admin. Without this guard a rider could POST /payments/verify with
    // their own `cash_<rideId>` order id and (with the dev provider, which
    // approves everything) mark the ride paid themselves — or, against
    // Razorpay, flip the cash order to 'failed'.
    if (payment.method === 'cash' || payment.providerOrderId?.startsWith('cash_')) {
      throw new BadRequestException(
        'Cash payments are confirmed by the driver, not verified through the gateway',
      );
    }
    if (ride.paymentStatus === 'disputed') {
      throw new ConflictException('Payment is disputed — an admin must resolve it first');
    }
    // Hardening: the whole check-and-settle runs under the ride row lock and
    // re-reads the ride AND payment inside it. Unlocked, a verify racing the
    // Razorpay webhook, a driver's "Amount Received" or an admin dispute could
    // act on a stale snapshot and overwrite the other path's decision.
    const outcome = await this.withRideLock(ride.id, async (lockedRide, manager) => {
      const lockedPayment = await manager.findOne(PaymentEntity, { where: { id: payment.id } });
      if (!lockedPayment) {
        throw new NotFoundException('Payment order not found');
      }
      if (lockedRide.paymentStatus === 'disputed') {
        throw new ConflictException('Payment is disputed — an admin must resolve it first');
      }
      const total = lockedRide.fareBreakdown.total;
      // Include tip so receipt matches what was charged (total + tip).
      const charged = total + (lockedRide.tipAmount ?? 0);
      if (lockedPayment.status === 'paid' || lockedRide.paymentStatus === 'paid') {
        // Idempotent: double-tap / retry after success (or the webhook won).
        return { kind: 'paid' as const, total: charged, receiptId: lockedPayment.id };
      }
      if (lockedPayment.amount < total || lockedPayment.amount > charged) {
        throw new BadRequestException(
          `Order amount ₹${lockedPayment.amount} does not match ride fare ₹${total}`,
        );
      }

      const verified = await this.provider.verifyPayment({
        orderId: dto.orderId,
        paymentId: dto.paymentId ?? '',
        signature: dto.signature ?? '',
      });

      lockedPayment.status = verified ? 'paid' : 'failed';
      lockedPayment.providerPaymentId = dto.paymentId ?? null;
      await manager.save(lockedPayment);
      if (!verified) {
        // The 'failed' row must COMMIT, so the 400 is thrown after the lock.
        return { kind: 'failed' as const };
      }

      await manager.update(
        RideEntity,
        { id: lockedRide.id },
        { paymentStatus: 'paid', paymentMarkedBy: 'provider' },
      );
      return { kind: 'paid' as const, total: charged, receiptId: lockedPayment.id };
    });

    if (outcome.kind === 'failed') {
      throw new BadRequestException('Payment verification failed');
    }
    return { paid: true, total: outcome.total, receiptId: outcome.receiptId };
  }

  // POST /payments/webhook/razorpay — the gateway → server settlement path
  // (pass-4, task 5). Signature FIRST: HMAC-SHA256 over the RAW body with
  // RAZORPAY_WEBHOOK_SECRET, constant-time compare. The payload is never
  // logged (it carries payment details); a bad signature answers 401 so the
  // delivery shows as failed in Razorpay's dashboard.
  async handleRazorpayWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    event: RazorpayWebhookDto,
  ): Promise<{ received: true }> {
    const secret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) {
      // Fail closed: without the secret nothing can be authenticated.
      throw new UnauthorizedException('Webhook secret not configured');
    }
    if (!rawBody || !signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const givenBuf = Buffer.from(signature, 'utf8');
    // Fixed-length hex digests; the length guard only keeps timingSafeEqual
    // from throwing on a short attacker-supplied header.
    if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Only the two settlement events matter. Everything else is acked with
    // 200 so Razorpay does not retry it forever.
    if (event.event !== 'payment.captured' && event.event !== 'order.paid') {
      return { received: true };
    }

    // Narrow the (signature-verified) payload to the fields we need — the
    // rest of it is untrusted data and is never logged or echoed.
    const payload = (event.payload ?? {}) as {
      payment?: {
        entity?: {
          id?: unknown;
          order_id?: unknown;
          amount?: unknown;
          currency?: unknown;
          status?: unknown;
        };
      };
      order?: { entity?: { id?: unknown } };
    };
    const orderId =
      (typeof payload.order?.entity?.id === 'string' ? payload.order.entity.id : undefined) ??
      (typeof payload.payment?.entity?.order_id === 'string'
        ? payload.payment.entity.order_id
        : undefined);
    const providerPaymentId =
      typeof payload.payment?.entity?.id === 'string' ? payload.payment.entity.id : null;
    if (!orderId) {
      return { received: true }; // nothing to correlate — ack, never retry-storm
    }

    const payment = await this.payments.findOne({
      where: { providerOrderId: orderId },
      order: { createdAt: 'DESC' },
    });
    if (!payment) return { received: true }; // not one of our orders
    const ride = await this.rides.findOne({ where: { id: payment.rideId } });
    if (!ride) return { received: true };
    if (payment.method === 'cash' || payment.providerOrderId?.startsWith('cash_')) {
      return { received: true }; // a gateway event can never settle a cash claim
    }
    // Idempotent: a replayed delivery must not rewrite anything.
    if (ride.paymentStatus === 'paid') return { received: true };
    // A disputed payment belongs to the admin resolution path (P-1) — do not
    // silently overwrite the admin's dispute from a gateway event.
    if (ride.paymentStatus === 'disputed') return { received: true };

    // Phase-2.1: settle ONLY what the SIGNED payload says was actually
    // captured. Our stored `payment.amount` is integer rupees; Razorpay
    // reports paise. A completed `order.paid` also carries the captured
    // payment entity, so "captured" is required for both settlement events —
    // an authorized-but-not-captured payment is not money in the account.
    const signed = payload.payment?.entity;
    const signedAmount = typeof signed?.amount === 'number' ? signed.amount : undefined;
    const signedCurrency = typeof signed?.currency === 'string' ? signed.currency : undefined;
    const signedStatus = typeof signed?.status === 'string' ? signed.status : undefined;
    const capturedAsOrdered =
      signedStatus === 'captured' &&
      signedCurrency === 'INR' &&
      signedAmount === payment.amount * 100;
    if (!capturedAsOrdered) {
      // Ack with 200 — a 4xx makes Razorpay retry this delivery forever — but
      // settle nothing, and log only the ids (never the payload/amounts).
      this.logger.warn(
        `Razorpay webhook not settled: ride ${ride.id} order ${orderId} (payment not captured, amount or currency mismatch)`,
      );
      return { received: true };
    }

    // Hardening: settle under the ride row lock, re-checking the LOCKED ride,
    // so a webhook racing /payments/verify, a driver confirmation or an admin
    // dispute cannot overwrite the other path's decision.
    await this.withRideLock(ride.id, async (lockedRide, manager) => {
      if (lockedRide.paymentStatus === 'paid' || lockedRide.paymentStatus === 'disputed') return;

      // Amount gate — same rule as verify(): the ordered amount must be the
      // ride total, with the tip as an upper bound only. A mismatch means a
      // wrong or tampered charge: reject loudly (400) instead of settling.
      const total = lockedRide.fareBreakdown.total;
      if (payment.amount < total || payment.amount > total + (lockedRide.tipAmount ?? 0)) {
        throw new BadRequestException(
          `Order amount ₹${payment.amount} does not match ride fare ₹${total}`,
        );
      }

      if (payment.status !== 'paid') {
        await manager.update(
          PaymentEntity,
          { id: payment.id },
          providerPaymentId ? { status: 'paid', providerPaymentId } : { status: 'paid' },
        );
      }
      await manager.update(
        RideEntity,
        { id: lockedRide.id },
        { paymentStatus: 'paid', paymentMarkedBy: 'provider' },
      );
    });
    return { received: true };
  }

  /**
   * Pass-4 (task 5): pessimistic row lock on the ride inside a transaction —
   * the same discipline as RidesService.withRideLock (duplicated here because
   * that helper is private and this module must not import the rides module
   * for one method). Used by createOrder so the "existing pending order or
   * create" check-then-insert is atomic. Contract: throwing rolls the
   * transaction back and rethrows; the commit has happened when this returns.
   */
  private async withRideLock<T>(
    rideId: string,
    fn: (ride: RideEntity, manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const queryRunner: QueryRunner = this.rides.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const ride = await queryRunner.manager.findOne(RideEntity, {
        where: { id: rideId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ride) throw new NotFoundException('Ride not found');
      const result = await fn(ride, queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => {});
      throw err;
    } finally {
      await queryRunner.release().catch(() => {});
    }
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
