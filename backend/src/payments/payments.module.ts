import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { PaymentEntity } from './entities/payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { DevPaymentProvider } from './providers/dev-payment.provider';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { RazorpayPaymentProvider } from './providers/razorpay-payment.provider';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEntity, RideEntity])],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    DevPaymentProvider,
    RazorpayPaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, DevPaymentProvider, RazorpayPaymentProvider],
      useFactory: (config: ConfigService, dev: DevPaymentProvider, razorpay: RazorpayPaymentProvider) =>
        (config.get<string>('PAYMENTS_DEV_MODE') ?? 'false') === 'true' ? dev : razorpay,
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
