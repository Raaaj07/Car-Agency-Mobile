/**
 * Display names for the ride's vehicle type. Same names as the vehicle picker
 * (VehicleSelectionScreen) and the backend fare catalog.
 *
 * The ride record (`activeRide.vehicleType`) is the truth for a booked ride.
 * The store's `selectedVehicle` is only the booking-form selection: it always
 * holds a default ("Comfort Sedan"), so after the app was killed and the ride
 * resumed it names the wrong vehicle.
 */
const VEHICLE_NAMES: Record<string, string> = {
  auto: 'Vazhi Auto',
  mini: 'Economy Mini',
  sedan: 'Comfort Sedan',
  suv: 'Premium SUV',
};

/** Display name for a vehicle type id, or null when it is missing / unknown. */
export function vehicleName(type: string | null | undefined): string | null {
  if (!type) return null;
  return VEHICLE_NAMES[type] ?? null;
}
