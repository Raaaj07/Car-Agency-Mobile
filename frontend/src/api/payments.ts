import { api } from './client';
import { PaymentMethod } from './rides';

export const paymentsApi = {
  createOrder: async (rideId: string, method: PaymentMethod) =>
    (await api.post<{ orderId: string | null; amount: number; currency: string; providerKey: string; status: 'pending' | 'rider_claimed' }>('/payments/create-order', { rideId, method })).data,
  verify: async (rideId: string, orderId: string) =>
    (await api.post<{ paid: true; total: number; receiptId: string }>('/payments/verify', { rideId, orderId })).data,
};
