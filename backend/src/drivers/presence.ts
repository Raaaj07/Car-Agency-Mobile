/**
 * How long an ONLINE driver stays visible and matchable without a new location
 * ping ("presence grace").
 *
 * A driver resting in a parking lot (phone locked, no GPS fix in a covered
 * car park, battery saver) sends no new location for a while, but is still
 * online and still wants rides. Before, a driver silent for 90 s was dropped
 * from the map, forced offline, and never offered anything. Now the last known
 * position stays valid for this long (default 15 minutes). Past it the driver
 * is treated as gone (crashed app, dead phone) and removed, exactly as before.
 *
 * `DRIVER_PRESENCE_GRACE_SECONDS` overrides it (clamped to 90 s - 6 h); 90
 * restores the old strict behaviour.
 */
export const DEFAULT_PRESENCE_GRACE_SECONDS = 15 * 60;
export const MIN_PRESENCE_GRACE_SECONDS = 90;
export const MAX_PRESENCE_GRACE_SECONDS = 6 * 60 * 60;

/** The grace window in milliseconds from the raw env value (blank / junk -> default). */
export function presenceGraceMs(raw: unknown): number {
  const seconds = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_PRESENCE_GRACE_SECONDS * 1000;
  }
  const clamped = Math.min(Math.max(Math.round(seconds), MIN_PRESENCE_GRACE_SECONDS), MAX_PRESENCE_GRACE_SECONDS);
  return clamped * 1000;
}
