import { api } from './client';
import { FareBreakdown, RideDriverInfo } from '../store/rideStore';

export type RideStatus = 'requested' | 'matched' | 'driver_en_route' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentMethod = 'upi' | 'wallet' | 'card' | 'cash';

export interface RideLocation { address: string; lat: number; lng: number; }
// P-1 state machine (mirrors backend): pending → rider_claimed → paid | disputed,
// plus 'failed' for a failed gateway verification.
export type PaymentStatus = 'pending' | 'rider_claimed' | 'paid' | 'disputed' | 'failed';

export interface Ride {
  id: string;
  status: RideStatus;
  vehicleType: string;
  pickup: RideLocation;
  dropoff: RideLocation;
  fareBreakdown: FareBreakdown;
  pickupOtp?: string | null;
  driverId?: string | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  distanceKm?: string | null;
  rating?: number | null;
  tipAmount?: number;
  cancellationReason?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  // Driver-side view only: first name of the rider.
  riderName?: string;
  // Driver-side view only: rider's profile photo (https or /users/<id>/avatar).
  riderAvatar?: string | null;
  // Rider-side view only: safe driver subset (null when unassigned).
  driver?: RideDriverInfo | null;
  // Only on create/rematch responses: whether a driver was offered right away
  // or the search came back empty (R-1 no-drivers state).
  match?: { status: 'offered' | 'no_drivers'; candidates: number };
}

export const ridesApi = {
  create: async (input: { pickup: RideLocation; dropoff: RideLocation; vehicleType: string; promoCode?: string | null; paymentMethod?: PaymentMethod; allowUpgrade?: boolean }) =>
    (await api.post<Ride>('/rides', input)).data,
  // R-1: "Retry" after a no-drivers match — re-runs the search server-side
  // instead of waiting out the search timeout.
  rematch: async (rideId: string) => (await api.post<Ride>(`/rides/${rideId}/rematch`)).data,
  // Backend infers rider vs driver from the JWT, so no role param needed —
  // riders get their bookings, drivers get rides they've driven.
  // Unified accounts: pass as='rider'|'driver' to select the side.
  list: async (page = 1, limit = 20, as?: 'rider' | 'driver') =>
    (await api.get<{ items: Ride[]; total: number }>('/rides', { params: { page, limit, ...(as ? { as } : {}) } })).data,
  get: async (rideId: string) => (await api.get<Ride>(`/rides/${rideId}`)).data,
  getActive: async () => (await api.get<Ride | null>('/rides/active')).data,
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
  // Driver confirms the rider paid the UPI QR shown on the driver's phone.
  // Flips paymentStatus to 'paid', which the admin console reports on.
  markPaymentReceived: async (rideId: string) =>
    (await api.patch<Ride>(`/rides/${rideId}/payment-received`)).data,
  getPendingOffer: async () =>
    (await api.get<{ ride: Ride; remainingSeconds: number } | null>('/rides/offers/pending')).data,
};