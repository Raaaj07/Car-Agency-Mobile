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

export interface AdminRideSummary {
  id: string;
  status: string;
  vehicleType: string;
  riderName: string;
  driverName: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareTotal: number;
  tipAmount: number;
  paymentStatus: 'pending' | 'rider_claimed' | 'paid' | 'disputed' | 'failed';
  paymentMethod: string;
  createdAt: string;
  completedAt: string | null;
}

// One uploaded document. Cloudinary-hosted files come with a short-lived signed
// `url`; legacy local-disk files come back inline as `base64`.
export interface AdminDocument {
  kind: 'licenseImage' | 'rcImage' | 'vehiclePhoto';
  label: string;
  mime: string;
  url: string | null;
  base64?: string;
  expiresAt: string | null;
}

export interface AdminFileResponse {
  mime: string;
  url?: string;
  base64?: string;
  expiresAt?: string | null;
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
  // Ride list for the admin console (statuses + fare + payment collection).
  listRides: async (page = 1, limit = 20) =>
    (
      await api.get<{ items: AdminRideSummary[]; total: number; page: number; limit: number }>('/admin/rides', {
        params: { page, limit },
      })
    ).data,
  approve: async (id: string) => (await api.post<ApplicationDetail>(`/admin/driver-applications/${id}/approve`)).data,
  reject: async (id: string, reason: string) =>
    (await api.post<ApplicationDetail>(`/admin/driver-applications/${id}/reject`, { reason })).data,
  suspend: async (driverId: string) => (await api.post(`/admin/drivers/${driverId}/suspend`)).data,
  reinstate: async (driverId: string) => (await api.post(`/admin/drivers/${driverId}/reinstate`)).data,
  // { mime, url, expiresAt } for Cloudinary docs (signed, ~10 min) or { mime, base64 } for legacy local files.
  file: async (applicationId: string, kind: 'licenseImage' | 'rcImage' | 'vehiclePhoto') =>
    (await api.get<AdminFileResponse>(`/admin/files/${applicationId}/${kind}`)).data,
  // All documents of an application in one call (handy for a web dashboard).
  documents: async (applicationId: string) =>
    (
      await api.get<{ applicationId: string; documents: AdminDocument[] }>(
        `/admin/driver-applications/${applicationId}/documents`,
      )
    ).data,
};
