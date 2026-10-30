/**
 * Arrival times on the "Choose a Ride" list, from the drivers that are really
 * online near the pickup (GET /drivers/nearby already returns an ETA per driver).
 * Replaces the fixed "3 min away" / "Fastest" values the list used to show.
 */
export interface EtaDriver {
  vehicleType: string;
  etaMinutes: number;
}

/** Shortest ETA in minutes per vehicle type (types with no usable driver are absent). */
export function etaByVehicle(drivers: EtaDriver[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const d of drivers) {
    if (!d || typeof d.vehicleType !== 'string') continue;
    if (!Number.isFinite(d.etaMinutes) || d.etaMinutes < 0) continue;
    const minutes = Math.max(1, Math.round(d.etaMinutes));
    const current = result[d.vehicleType];
    if (current === undefined || minutes < current) result[d.vehicleType] = minutes;
  }
  return result;
}

/**
 * The vehicle type to badge "Fastest", or null. A badge only means something when
 * at least two types have a driver and exactly one of them is quickest, so a tie or
 * a single available type gets no badge.
 */
export function fastestVehicleId(etas: Record<string, number>): string | null {
  const entries = Object.entries(etas);
  if (entries.length < 2) return null;
  const best = Math.min(...entries.map(([, minutes]) => minutes));
  const winners = entries.filter(([, minutes]) => minutes === best);
  return winners.length === 1 ? winners[0][0] : null;
}

export type EtaStatus = 'loading' | 'ready' | 'error';

/** What to print under a vehicle name. */
export function etaText(status: EtaStatus, etas: Record<string, number>, vehicleId: string): string {
  if (status === 'loading') return 'Checking nearby drivers\u2026';
  if (status === 'error') return 'Arrival time unavailable';
  const minutes = etas[vehicleId];
  return minutes === undefined ? 'No drivers nearby right now' : `${minutes} min away`;
}
