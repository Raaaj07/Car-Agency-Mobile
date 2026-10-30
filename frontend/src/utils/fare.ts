/**
 * Fare PREVIEW shown before booking. It mirrors the backend formula in
 * `backend/src/rides/fare-catalog.ts` (`computeNumericPrice` +
 * `computeFareBreakdown`) so the price the rider confirms is the price the
 * server computes for the same route distance. If a rate or the split changes
 * there, change it here too (the tests below pin the current numbers).
 *
 * The final fare is still decided by the server from the distance actually
 * driven, so the screens call this an estimate.
 */
interface FareRate {
  /** Price for the 5 km reference trip (what the old fixed price list showed). */
  referencePrice: number;
  perKm: number;
}

const RATES: Record<string, FareRate> = {
  auto: { referencePrice: 110, perKm: 22 },
  mini: { referencePrice: 180, perKm: 36 },
  sedan: { referencePrice: 240, perKm: 48 },
  suv: { referencePrice: 350, perKm: 70 },
};

/** Floor so a very short trip is never nearly free (same as the backend). */
const MIN_FARE_MULTIPLIER = 0.6;
/** Distances below this are billed as this much (same as the backend). */
const MIN_BILLABLE_KM = 0.5;
/** Fixed parts added to every ride (same as the backend). */
const TOLL_FEE = 40;
const TAXES = 28;

/**
 * Price for a trip of `distanceKm` (before the fixed toll/taxes and any promo),
 * or null when the vehicle is unknown or the distance is not usable yet - the
 * caller then keeps the reference price.
 */
export function estimateNumericPrice(vehicleId: string, distanceKm: number | null | undefined): number | null {
  const rate = RATES[vehicleId];
  if (!rate) return null;
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  const raw = rate.perKm * Math.max(distanceKm, MIN_BILLABLE_KM);
  const floor = rate.referencePrice * MIN_FARE_MULTIPLIER;
  return Math.round(Math.max(raw, floor));
}

/**
 * What the rider pays for a given `numericPrice`: 50% base + 30% distance +
 * 10% time + fixed toll and taxes - discount, never below zero.
 */
export function estimateFareTotal(numericPrice: number, discount = 0): number {
  const base = Math.round(numericPrice * 0.5);
  const distance = Math.round(numericPrice * 0.3);
  const time = Math.round(numericPrice * 0.1);
  return Math.max(base + distance + time + TOLL_FEE + TAXES - discount, 0);
}
