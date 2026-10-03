import { ridesApi, Ride } from '../api/rides';
import { ActiveRide, useRideStore } from '../store/rideStore';

export type ActiveRideStatus = string;

const ACTIVE_STATUSES = ['requested', 'matched', 'driver_en_route', 'in_progress'] as const;

// Set while POST /rides is in flight (booking request in progress) so a
// concurrent restoreActiveRide() cannot wipe the ride being created.
let bookingInFlight = 0;

export function beginBooking(): void {
  bookingInFlight += 1;
}

export function endBooking(): void {
  bookingInFlight = Math.max(0, bookingInFlight - 1);
}

export function isActiveStatus(status: string | undefined): boolean {
  return !!status && (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Map an active ride status to the rider booking-flow screen name. */
export function screenForStatus(status: string): 'FindingDriver' | 'YouGotTheRide' | 'DriverEnRoute' | 'TripProgress' {
  switch (status) {
    case 'requested':
      return 'FindingDriver';
    case 'matched':
      return 'YouGotTheRide';
    case 'driver_en_route':
      return 'DriverEnRoute';
    case 'in_progress':
    default:
      return 'TripProgress';
  }
}

function isRecentlyCreated(ride: { createdAt?: string }): boolean {
  if (!ride.createdAt) return false;
  const created = Date.parse(ride.createdAt);
  if (!Number.isFinite(created)) return false;
  return Date.now() - created < 15_000;
}

/** Copy an API Ride into the in-memory store so map screens work. */
export function applyRideToStore(ride: Ride): void {
  const st = useRideStore.getState();
  st.setActiveRide({ ...(ride as unknown as ActiveRide), source: 'rider-restore' });
  if (ride.pickup) {
    st.setPickup(
      ride.pickup.address,
      ride.pickup.address,
      { lat: ride.pickup.lat, lng: ride.pickup.lng },
    );
  }
  if (ride.dropoff) {
    st.setDropoff(
      ride.dropoff.address,
      ride.dropoff.address,
      { lat: ride.dropoff.lat, lng: ride.dropoff.lng },
    );
  }
}

/**
 * Server says the rider has no active ride but the store still holds one:
 * it was cancelled/completed elsewhere (or by the stale sweep), so drop it.
 * Never clears while a booking request is in flight or was just created.
 */
function clearStaleActiveRide(): void {
  if (bookingInFlight > 0) return;
  const current = useRideStore.getState().activeRide;
  if (!current || !isActiveStatus(current.status)) return;
  if (isRecentlyCreated(current)) return;
  useRideStore.getState().resetRide();
}

/**
 * Entering driver mode: any active ride that came from restoreActiveRide()
 * is the rider's own booking and must not be shown as a job offer.
 */
export function clearRestoredRiderRide(): void {
  if (bookingInFlight > 0) return;
  const current = useRideStore.getState().activeRide;
  if (!current || !isActiveStatus(current.status)) return;
  if (current.source !== 'rider-restore') return;
  if (isRecentlyCreated(current)) return;
  useRideStore.getState().resetRide();
}

/**
 * Restore the rider's active ride from the server into the store.
 * Returns the ride or null. Failures are swallowed silently (offline first
 * launch must not break the app).
 */
export async function restoreActiveRide(): Promise<Ride | null> {
  try {
    const ride = await ridesApi.getActive();
    if (ride && isActiveStatus(ride.status)) {
      applyRideToStore(ride);
      return ride;
    }
    if (!ride) {
      clearStaleActiveRide();
    }
    return null;
  } catch {
    return null;
  }
}
