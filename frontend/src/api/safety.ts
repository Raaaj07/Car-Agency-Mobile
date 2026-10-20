import { api } from './client';

export interface EmergencyContact {
  name: string | null;
  phone: string | null;
}

export interface ShareLink {
  token: string;
  path: string;
  url: string | null;
  expiresAt: string;
}

export interface SosResult {
  ok: boolean;
  emergencyContact: { name: string | null; phone: string | null } | null;
  emergencyNumber: string;
}

export const safetyApi = {
  getEmergencyContact: async () => (await api.get<EmergencyContact>('/safety/emergency-contact')).data,
  setEmergencyContact: async (name: string, phone: string) =>
    (await api.put<EmergencyContact>('/safety/emergency-contact', { name, phone })).data,
  clearEmergencyContact: async () => (await api.delete<EmergencyContact>('/safety/emergency-contact')).data,
  shareTrip: async (rideId: string) => (await api.post<ShareLink>(`/safety/rides/${rideId}/share`)).data,
  stopSharing: async (rideId: string) => (await api.delete(`/safety/rides/${rideId}/share`)).data,
  sos: async (rideId: string, location?: { lat: number; lng: number }) =>
    (await api.post<SosResult>(`/safety/rides/${rideId}/sos`, location ? { location } : {})).data,
};
