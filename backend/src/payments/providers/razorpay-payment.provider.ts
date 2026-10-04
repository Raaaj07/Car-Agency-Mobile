import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { CreateOrderResult, PaymentProvider, VerifyPaymentInput } from './payment-provider.interface';

/**
 * Real Razorpay integration, used when PAYMENTS_DEV_MODE=false and
 * RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are set.
 * Docs: https://razorpay.com/docs/api/orders/ and
 * https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/#step-3-verify-payment-signature
 */
@Injectable()
export class RazorpayPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(RazorpayPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  providerKey(): string {
    return this.config.get<string>('RAZORPAY_KEY_ID') ?? '';
  }

  async createOrder(amountRupees: number, receiptId: string): Promise<CreateOrderResult> {
    const keyId = this.config.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) {
      this.logger.warn('Razorpay credentials not configured.');
      throw new Error('Payment provider not configured');
    }

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        amount: Math.round(amountRupees * 100), // paise
        currency: 'INR',
        receipt: receiptId,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Razorpay order creation failed: ${response.status}`);
      throw new ServiceUnavailableException('Failed to create payment order');
    }

    const order = (await response.json()) as { id: string; amount: number };
    return { orderId: order.id, amount: order.amount / 100, currency: 'INR', providerKey: keyId };
  }

  async verifyPayment({ orderId, paymentId, signature }: VerifyPaymentInput): Promise<boolean> {
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keySecret || !orderId || !paymentId || !signature) return false;

    const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
