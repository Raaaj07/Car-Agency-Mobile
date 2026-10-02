import { VehicleOption } from '../common/frontend-contracts';
import { VehicleType } from '../drivers/entities/driver.entity';

/**
 * Base prices copied verbatim from VehicleSelectionScreen's hardcoded
 * `vehicles` array (frontend/src/screens/rider/VehicleSelectionScreen.tsx)
 * so a 5 km / 15 min reference trip reproduces the exact numbers the
 * frontend currently shows. Real bookings scale off basePricePerKm from
 * there using the ride's actual distance.
 */
export const VEHICLE_FARE_CATALOG: Record<
  VehicleType,
  Omit<VehicleOption, 'eta'> & { basePricePerKm: number; referenceKm: number }
> = {
  auto: {
    id: 'auto',
    name: 'Vazhi Auto',
    type: 'Affordable 3-wheeler',
    price: '₹110',
    numericPrice: 110,
    seats: 3,
    badge: 'Popular',
    icon: '🛺',
    basePricePerKm: 22,
    referenceKm: 5,
  },
  mini: {
    id: 'mini',
    name: 'Economy Mini',
    type: 'Compact hatchbacks',
    price: '₹180',
    numericPrice: 180,
    seats: 4,
    icon: '🚗',
    basePricePerKm: 36,
    referenceKm: 5,
  },
  sedan: {
    id: 'sedan',
    name: 'Comfort Sedan',
    type: 'Spacious AC sedans',
    price: '₹240',
    numericPrice: 240,
    seats: 4,
    badge: 'Fastest',
    icon: '🚘',
    basePricePerKm: 48,
    referenceKm: 5,
  },
  suv: {
    id: 'suv',
    name: 'Premium SUV',
    type: '6-seater family rides',
    price: '₹350',
    numericPrice: 350,
    seats: 6,
    icon: '🚙',
    basePricePerKm: 70,
    referenceKm: 5,
  },
};

const MIN_FARE_MULTIPLIER = 0.6; // floor so very short trips aren't free

/** numericPrice for a real trip of `distanceKm`, based on the catalog rate. */
export function computeNumericPrice(vehicleType: VehicleType, distanceKm: number): number {
  const catalog = VEHICLE_FARE_CATALOG[vehicleType];
  const raw = catalog.basePricePerKm * Math.max(distanceKm, 0.5);
  const floor = catalog.numericPrice * MIN_FARE_MULTIPLIER;
  return Math.round(Math.max(raw, floor));
}

/**
 * Same 50/30/10 + fixed toll/tax split `getFareBreakdown()` uses in
 * rideStore.ts, applied to the real numericPrice for this trip.
 * Total includes all components minus discount so the parts always sum up.
 */
export function computeFareBreakdown(numericPrice: number, discountAmount: number) {
  const baseFare = Math.round(numericPrice * 0.5);
  const distanceFare = Math.round(numericPrice * 0.3);
  const timeCharge = Math.round(numericPrice * 0.1);
  const tollFee = 40;
  const taxes = 28;
  const total = Math.max(baseFare + distanceFare + timeCharge + tollFee + taxes - discountAmount, 0);

  return {
    baseFare,
    distanceFare,
    timeCharge,
    tollFee,
    taxes,
    discount: discountAmount,
    total,
  };
}
