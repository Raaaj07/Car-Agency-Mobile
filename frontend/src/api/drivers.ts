import { api } from './client';

export type VehicleType = 'auto' | 'mini' | 'sedan' | 'suv';

export interface RegisterDriverInput {
  vehicleType: VehicleType;
  carModel: string;
  plateNumber: string;
}

export interface DriverProfile {
  name: string;
  phone: string;
  avatar?: string | null;
  vehicleType: VehicleType;
  carModel: string;
  plateNumber: string;
  rating: number;
  totalTrips: number;
  todayEarnings: number;
  todayTrips: number;
  isOnline: boolean;
}

export interface NearbyDriver {
  driverId: string;
  userId: string;
  name: string;
  vehicleType: VehicleType;
  carModel: string;
  plateNumber: string;
  rating: number;
  distanceMeters: number;
  etaMinutes: number;
  lat: number;
  lng: number;
}

export const driversApi = {
  register: async (input: RegisterDriverInput) => (await api.post('/drivers/register', input)).data,
  setStatus: async (isOnline: boolean) => (await api.post('/drivers/status', { isOnline })).data,
  updateLocation: async (lat: number, lng: number) => (await api.patch('/drivers/location', { lat, lng })).data,
  // Backend already filters this to isOnline && isAvailable drivers, so
  // anything this returns is exactly "the nearest online driver" set.
  nearby: async (lat: number, lng: number, vehicleType?: string): Promise<NearbyDriver[]> =>
    (await api.get<NearbyDriver[]>('/drivers/nearby', { params: { lat, lng, vehicleType } })).data,
  getMyProfile: async (): Promise<DriverProfile> => (await api.get('/drivers/me')).data,
};