import { api } from './client';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface ApplicationSummary {
  id: string;
  userId: string;
  applicantName: string;
  phone: string;
  status: ApplicationStatus;
  vehicleType: string;
  carModel: string;
  plateNumber: string;
  licenseNumber: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface ApplicationDetail extends ApplicationSummary {
  email: string | null;
  rejectionReason: string | null;
  rcNumber: string | null;
  reviewedByUserId: string | null;
  hasLicenseImage: boolean;
  hasRcImage: boolean;
  hasVehiclePhoto: boolean;
}

export const adminApi = {
  list: async (status?: ApplicationStatus, page = 1, limit = 20) =>
    (
      await api.get<{ items: ApplicationSummary[]; total: number; page: number; limit: number }>(
        '/admin/driver-applications',
        { params: { ...(status ? { status } : {}), page, limit } },
      )
    ).data,
  get: async (id: string) => (await api.get<ApplicationDetail>(`/admin/driver-applications/${id}`)).data,
  approve: async (id: string) => (await api.post<ApplicationDetail>(`/admin/driver-applications/${id}/approve`)).data,
  reject: async (id: string, reason: string) =>
    (await api.post<ApplicationDetail>(`/admin/driver-applications/${id}/reject`, { reason })).data,
  suspend: async (driverId: string) => (await api.post(`/admin/drivers/${driverId}/suspend`)).data,
  reinstate: async (driverId: string) => (await api.post(`/admin/drivers/${driverId}/reinstate`)).data,
  // Returns { mime, base64 } so <Image source={{uri: data:...}}> works without headers.
  file: async (applicationId: string, kind: 'licenseImage' | 'rcImage' | 'vehiclePhoto') =>
    (await api.get<{ mime: string; base64: string }>(`/admin/files/${applicationId}/${kind}`)).data,
};
