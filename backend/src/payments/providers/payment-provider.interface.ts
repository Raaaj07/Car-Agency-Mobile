export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface CreateOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  // Razorpay checkout needs this to open the client-side widget; stub
  // providers can return an empty string.
  providerKey: string;
}

export interface VerifyPaymentInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface PaymentProvider {
  createOrder(amountRupees: number, receiptId: string): Promise<CreateOrderResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<boolean>;
}
