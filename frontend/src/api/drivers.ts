import { api } from './client';

export type VehicleType = 'auto' | 'mini' | 'sedan' | 'suv';

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
  isAvailable?: boolean;
  status?: 'pending' | 'approved' | 'rejected' | 'suspended';
  rejectionReason?: string | null;
  submittedAt?: string | null;
  profilePhotoUrl?: string | null;
  carImageUrl?: string | null;
  drivingLicenceNumber?: string | null;
  drivingLicenceImageUrl?: string | null;
  rcNumber?: string | null;
  rcImageUrl?: string | null;
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

export interface DriverApplication {
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  vehicleType: VehicleType;
  carModel: string;
  plateNumber: string;
  licenseNumber: string | null;
  rcNumber: string | null;
  hasLicenseImage: boolean;
  hasRcImage: boolean;
  hasVehiclePhoto: boolean;
}

export const driversApi = {
  apply: async (
    input: { vehicleType: VehicleType; carModel: string; plateNumber: string; licenseNumber: string; rcNumber?: string },
    files: { licenseImage: { uri: string; name: string; type: string }; rcImage: { uri: string; name: string; type: string }; vehiclePhoto?: { uri: string; name: string; type: string } },
    onProgress?: (pct: number) => void,
  ) => {
    const form = new FormData();
    form.append('vehicleType', input.vehicleType);
    form.append('carModel', input.carModel);
    form.append('plateNumber', input.plateNumber);
    form.append('licenseNumber', input.licenseNumber);
    if (input.rcNumber) form.append('rcNumber', input.rcNumber);
    form.append('licenseImage', files.licenseImage as any);
    form.append('rcImage', files.rcImage as any);
    if (files.vehiclePhoto) form.append('vehiclePhoto', files.vehiclePhoto as any);
    return (
      await api.post('/drivers/apply', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
        onUploadProgress: (e) => {
          if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100));
        },
      })
    ).data;
  },
  application: async (): Promise<DriverApplication | null> => (await api.get('/drivers/application')).data,
  setStatus: async (isOnline: boolean) => (await api.post('/drivers/status', { isOnline })).data,
  updateLocation: async (lat: number, lng: number) => (await api.patch('/drivers/location', { lat, lng })).data,
  // Backend already filters this to isOnline && isAvailable drivers, so
  // anything this returns is exactly "the nearest online driver" set.
  nearby: async (lat: number, lng: number, vehicleType?: string): Promise<NearbyDriver[]> =>
    (await api.get<NearbyDriver[]>('/drivers/nearby', { params: { lat, lng, vehicleType } })).data,
  getMyProfile: async (): Promise<DriverProfile | null> => (await api.get('/drivers/me')).data,
};