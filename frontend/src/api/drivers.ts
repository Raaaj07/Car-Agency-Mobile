import { api } from './client';

export type VehicleType = 'auto' | 'mini' | 'sedan' | 'suv';

export interface RegisterDriverInput {
  vehicleType: VehicleType;
  carModel: string;
  plateNumber: string;
}

export const driversApi = {
  register: async (input: RegisterDriverInput) => (await api.post('/drivers/register', input)).data,
  setStatus: async (isOnline: boolean) => (await api.post('/drivers/status', { isOnline })).data,
  updateLocation: async (lat: number, lng: number) => (await api.patch('/drivers/location', { lat, lng })).data,
  nearby: async (lat: number, lng: number, vehicleType?: string) =>
    (await api.get('/drivers/nearby', { params: { lat, lng, vehicleType } })).data,
};