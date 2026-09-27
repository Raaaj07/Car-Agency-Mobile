/**
 * These interfaces are copied verbatim (field-for-field) from the frontend:
 *   frontend/src/store/rideStore.ts  -> VehicleOption, FareBreakdown, DriverInfo
 *   frontend/src/store/authStore.ts  -> User
 *
 * Every API response that returns one of these shapes must satisfy the
 * interface exactly so the frontend can consume it with zero remapping.
 * Do not add/rename/remove fields here without updating the frontend too.
 */

export interface VehicleOption {
  id: string;
  name: string;
  type: string;
  price: string; // display string, e.g. "₹240"
  numericPrice: number;
  eta: string; // display string, e.g. "2 min"
  seats: number;
  badge?: string;
  icon: string; // emoji
}

export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  timeCharge: number;
  tollFee: number;
  taxes: number;
  discount: number;
  total: number;
}

export interface DriverInfo {
  name: string;
  rating: number;
  carModel: string;
  plateNumber: string;
  otp: string;
  eta: string;
  phone: string;
}

export interface User {
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
}