import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { PaymentEntity } from './entities/payment.entity';
import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment-provider.interface';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // POST /payments/create-order — Razorpay order for the ride total.
  async createOrder(riderId: string, dto: CreateOrderDto) {
    const ride = await this.getRideForRider(dto.rideId, riderId);
    if (ride.status !== 'completed') {
      throw new BadRequestException('Ride must be completed before payment');
    }

    const amount = ride.fareBreakdown.total + (ride.tipAmount ?? 0);

    if (dto.method === 'cash') {
      // Cash on delivery: settle immediately, no online order needed —
      // matches RideDetailsScreen's default "UPI / Cash on Delivery" copy.
      const payment = await this.payments.save(
        this.payments.create({
          rideId: ride.id,
          method: 'cash',
          amount,
          providerOrderId: `cash_${ride.id}`,
          status: 'paid',
        }),
      );
      await this.rides.update({ id: ride.id }, { paymentMethod: 'cash', paymentStatus: 'paid' });
      return { orderId: payment.providerOrderId, amount, currency: 'INR', providerKey: '', status: 'paid' as const };
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

  // POST /payments/verify — confirms payment, marks ride paid.
  async verify(riderId: string, dto: VerifyPaymentDto) {
    const ride = await this.getRideForRider(dto.rideId, riderId);
    const payment = await this.payments.findOne({
      where: { rideId: ride.id, providerOrderId: dto.orderId },
      order: { createdAt: 'DESC' },
    });
    if (!payment) {
      throw new NotFoundException('Payment order not found');
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

    await this.rides.update({ id: ride.id }, { paymentStatus: 'paid' });
    // PaymentFareBreakdownScreen's exact shape: total, plus a receipt id.
    return { paid: true, total: ride.fareBreakdown.total, receiptId: payment.id };
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
