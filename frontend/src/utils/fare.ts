/**
 * Fare PREVIEW shown before booking. It mirrors the backend formula in
 * `backend/src/rides/fare-catalog.ts` (`computeNumericPrice` +
 * `computeFareBreakdown`) so the price the rider confirms is the price the
 * server computes for the same route distance. If a rate or the split changes
 * there, change it here too (the tests below pin the current numbers).
 *
 * The rider pays the trip price (minus any promo): there is no flat toll and
 * no flat tax any more.
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

/** Same shape as the backend / store `FareBreakdown`. */
export interface FareParts {
  baseFare: number;
  distanceFare: number;
  timeCharge: number;
  /** Always 0: kept so the API shape and older rides stay compatible. */
  tollFee: number;
  /** Always 0: kept so the API shape and older rides stay compatible. */
  taxes: number;
  discount: number;
  total: number;
}

/**
 * Price for a trip of `distanceKm` (before any promo), or null when the
 * vehicle is unknown or the distance is not usable yet - the caller then
 * keeps the reference price.
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
 * The fare split for a given `numericPrice`: 50% base + 30% distance and the
 * remainder as the time charge, so the parts add up to the price exactly.
 * Minus the discount, never below zero.
 */
export function estimateFareBreakdown(numericPrice: number, discount = 0): FareParts {
  const baseFare = Math.round(numericPrice * 0.5);
  const distanceFare = Math.round(numericPrice * 0.3);
  const timeCharge = Math.max(numericPrice - baseFare - distanceFare, 0);
  const total = Math.max(baseFare + distanceFare + timeCharge - discount, 0);
  return { baseFare, distanceFare, timeCharge, tollFee: 0, taxes: 0, discount, total };
}

/** What the rider pays for a given `numericPrice` (see estimateFareBreakdown). */
export function estimateFareTotal(numericPrice: number, discount = 0): number {
  return estimateFareBreakdown(numericPrice, discount).total;
}
