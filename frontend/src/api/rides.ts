import { api } from './client';
import { FareBreakdown } from '../store/rideStore';

export type RideStatus = 'requested' | 'matched' | 'driver_en_route' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentMethod = 'upi' | 'wallet' | 'card' | 'cash';

export interface RideLocation { address: string; lat: number; lng: number; }
export interface Ride {
  id: string;
  status: RideStatus;
  vehicleType: string;
  pickup: RideLocation;
  dropoff: RideLocation;
  fareBreakdown: FareBreakdown;
  pickupOtp?: string | null;
  driverId?: string | null;
  paymentStatus: 'pending' | 'paid' | 'failed';
  paymentMethod: PaymentMethod;
  distanceKm?: string | null;
  rating?: number | null;
  tipAmount?: number;
  cancellationReason?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export const ridesApi = {
  create: async (input: { pickup: RideLocation; dropoff: RideLocation; vehicleType: string; promoCode?: string | null; paymentMethod?: PaymentMethod; allowUpgrade?: boolean }) =>
    (await api.post<Ride>('/rides', input)).data,
  // Backend infers rider vs driver from the JWT, so no role param needed —
  // riders get their bookings, drivers get rides they've driven.
  // Unified accounts: pass as='rider'|'driver' to select the side.
  list: async (page = 1, limit = 20, as?: 'rider' | 'driver') =>
    (await api.get<{ items: Ride[]; total: number }>('/rides', { params: { page, limit, ...(as ? { as } : {}) } })).data,
  get: async (rideId: string) => (await api.get<Ride>(`/rides/${rideId}`)).data,
  cancel: async (rideId: string, reason: string) => (await api.patch<Ride>(`/rides/${rideId}/cancel`, { reason })).data,
  review: async (rideId: string, input: { rating: number; compliments: string[]; tipAmount: number }) =>
    (await api.patch<Ride>(`/rides/${rideId}/review`, input)).data,
  accept: async (rideId: string) => (await api.patch<Ride>(`/rides/${rideId}/accept`)).data,
  decline: async (rideId: string) => (await api.patch<Ride>(`/rides/${rideId}/decline`)).data,
  enRoute: async (rideId: string) => (await api.patch<Ride>(`/rides/${rideId}/en-route`)).data,
  start: async (rideId: string) => (await api.patch<{ ride: Ride; readyForOtp: true }>(`/rides/${rideId}/start`)).data,
  verifyPickupOtp: async (rideId: string, otp: string) => (await api.patch<Ride>(`/rides/${rideId}/verify-pickup-otp`, { otp })).data,
  complete: async (rideId: string, actualDistanceKm?: number) =>
    (await api.patch<Ride>(`/rides/${rideId}/complete`, actualDistanceKm ? { actualDistanceKm } : {})).data,
  getPendingOffer: async () =>
    (await api.get<{ ride: Ride; remainingSeconds: number } | null>('/rides/offers/pending')).data,
};