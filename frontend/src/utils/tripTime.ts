/**
 * Length of the trip itself, in whole minutes (minimum 1): from the moment the
 * driver verified the pickup OTP to completion. Booking-to-completion would
 * include searching for a driver and waiting at the pickup.
 *
 * Returns null when either time is missing or unusable (for example a trip
 * from before `startedAt` was sent), so the screen shows "-" instead of a
 * wrong number.
 */
export function tripDurationMinutes(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | null {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(1, Math.round((end - start) / 60_000));
}
