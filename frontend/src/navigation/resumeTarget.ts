/**
 * Pure rules for "which rider screen should the app reopen on?".
 *
 * No React / React Native / store imports on purpose: these are the decisions
 * that matter after the app was killed mid-ride, so they must be testable in
 * plain Jest (node) without a renderer.
 */

/** Ride statuses that mean "a ride is in flight" (same set the server treats as active). */
export const ACTIVE_STATUSES = ['requested', 'matched', 'driver_en_route', 'in_progress'] as const;

export type LiveRideScreen = 'FindingDriver' | 'YouGotTheRide' | 'DriverEnRoute' | 'TripProgress';
export type RiderResumeScreen = LiveRideScreen | 'ReviewRide';

export function isActiveStatus(status: string | undefined): boolean {
  return !!status && (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Map an active ride status to the rider booking-flow screen name. */
export function screenForStatus(status: string): LiveRideScreen {
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

export interface ResumeCandidate {
  status: string;
  rating?: number | null;
}

/**
 * The screen to reopen on for a ride the server still considers open, or null
 * when the rider should simply land on Home:
 *  - an active ride        -> its live screen
 *  - completed, not rated  -> the review screen
 *  - anything else (cancelled, completed and rated, no ride) -> null
 */
export function resumeScreenFor(ride: ResumeCandidate | null | undefined): RiderResumeScreen | null {
  if (!ride) return null;
  if (isActiveStatus(ride.status)) return screenForStatus(ride.status);
  if (ride.status === 'completed' && ride.rating == null) return 'ReviewRide';
  return null;
}

/**
 * Whether a launch-time resume may take over the screen. It must not when the
 * rider already started a booking of their own in this session (a ride in the
 * store that did NOT come from a restore) - their flow wins over a stale answer
 * that arrived late.
 */
export function mayResumeOnLaunch(storeRide: { source?: string } | null | undefined): boolean {
  if (!storeRide) return true;
  return storeRide.source === 'rider-restore';
}
