/**
 * Helpers for the driver's location heartbeat (DriverDashboardScreen).
 * Pure (no React / Expo imports) so they run in plain Jest.
 */

/**
 * Rejects when `promise` has not settled within `ms`. Used so a GPS read that
 * never returns (covered car park, tunnel, indoors) cannot block the heartbeat.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** A GPS read taking longer than this is given up (the heartbeat tick is 5 s). */
export const GPS_FIX_TIMEOUT_MS = 4_000;

/**
 * While GPS cannot give a fix, the heartbeat keeps sending the LAST KNOWN
 * position so a parked driver stays on the map (the server drops a driver it
 * has not heard from). Only for this long after the last real fix: past it the
 * position is too old to trust and the driver is left to drop off instead of
 * being shown somewhere they may no longer be.
 */
export const LAST_KNOWN_MAX_AGE_MS = 30 * 60_000;

/** True when the last real GPS fix (epoch ms; 0 = never) is recent enough to re-send. */
export function canSendLastKnown(
  lastFixAtMs: number,
  nowMs: number,
  maxAgeMs: number = LAST_KNOWN_MAX_AGE_MS,
): boolean {
  if (!Number.isFinite(lastFixAtMs) || lastFixAtMs <= 0) return false;
  return nowMs - lastFixAtMs <= maxAgeMs;
}
