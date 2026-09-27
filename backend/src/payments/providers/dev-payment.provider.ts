import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateOrderResult, PaymentProvider, VerifyPaymentInput } from './payment-provider.interface';

/**
 * PAYMENTS_DEV_MODE=true: no real Razorpay account needed for local/dev
 * testing against the Expo app. Orders auto-verify.
 */
@Injectable()
export class DevPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger('DevPaymentProvider');

  async createOrder(amountRupees: number, receiptId: string): Promise<CreateOrderResult> {
    const orderId = `dev_order_${randomUUID()}`;
    this.logger.log(`[DEV PAYMENT] order ${orderId} for receipt ${receiptId}: ₹${amountRupees}`);
    return { orderId, amount: amountRupees, currency: 'INR', providerKey: '' };
  }

  async verifyPayment(_input: VerifyPaymentInput): Promise<boolean> {
    return true;
  }
}
