import { api } from './client';
import { FareBreakdown } from '../store/rideStore';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type RideStatus = 'requested' | 'matched' | 'driver_en_route' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'rider_claimed' | 'paid' | 'disputed' | 'failed';
export type PaymentMethod = 'upi' | 'wallet' | 'card' | 'cash';
export type PaymentMarkedBy = 'rider' | 'driver' | 'admin' | 'provider' | null;

export type AuditAction =
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'reinstate'
  | 'ride_cancel'
  | 'payment_resolve'
  | 'upi_update';

export interface ApplicationSummary {
  id: string;
  userId: string;
  applicantName: string;
  phone: string;
  avatar: string | null;
  status: ApplicationStatus;
  vehicleType: string;
  carModel: string;
  plateNumber: string;
  licenseNumber: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  /** Active-driver extras for list rows (spec §3.2); absent on detail payloads. */
  rating?: number;
  totalTrips?: number;
  isOnline?: boolean;
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

export type ApplicationCounts = Record<ApplicationStatus, number> & { total: number };

export interface DriverStats {
  rating: number;
  totalTrips: number;
  todayEarnings: number;
  todayTrips: number;
  isOnline: boolean;
  isAvailable: boolean;
  lastLocationAt: string | null;
}

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: AuditAction;
  targetType: 'driver' | 'ride';
  targetId: string;
  /** Driver's name or the ride's rider name; null for deleted targets. */
  targetName: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** GET /admin/drivers/:id — application + live stats + rides + review history. */
export interface DriverDetail extends ApplicationDetail {
  isActive: boolean | null;
  reviewerName: string | null;
  approvedAt: string | null;
  stats: DriverStats;
  lastRides: AdminRideSummary[];
  history: AuditEntry[];
}

export interface AdminRideSummary {
  id: string;
  status: RideStatus;
  vehicleType: string;
  riderId: string;
  riderName: string;
  driverId: string | null;
  driverName: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareTotal: number;
  tipAmount: number;
  paymentStatus: PaymentStatus;
  paymentMarkedBy: PaymentMarkedBy;
  paymentMethod: PaymentMethod;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: 'rider' | 'driver' | 'system' | 'admin' | null;
}

export interface RideLocationDto {
  address: string;
  lat: number;
  lng: number;
}

export interface AdminPaymentRow {
  id: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  createdAt: string;
}

/** GET /admin/rides/:id — timeline, fare, payment rows, masked rider/driver. */
export interface AdminRideDetail extends AdminRideSummary {
  pickup: RideLocationDto;
  dropoff: RideLocationDto;
  fareBreakdown: FareBreakdown;
  distanceKm: number | null;
  promoCode: string | null;
  rating: number | null;
  timeline: {
    createdAt: string;
    offeredAt: string | null;
    matchedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
  };
  cancellation: { reason: string | null; by: AdminRideSummary['cancelledBy'] };
  rider: { id: string; name: string; phone: string };
  driver: {
    id: string;
    name: string;
    phone: string;
    vehicleType: string;
    carModel: string | null;
    plateNumber: string | null;
    rating: number | null;
    /** D-1: payee VPA the ride's QR pointed at. */
    upiVpa: string | null;
  } | null;
  payments: AdminPaymentRow[];
  /** R-7: recorded distance > 1.5x the straight-line route (inflated claim). */
  distanceOutlier: boolean;
}

export interface AdminOverview {
  timezone: string;
  generatedAt: string;
  applications: ApplicationCounts;
  drivers: { total: number; online: number; onTrip: number };
  rides: {
    active: number;
    today: number;
    completedToday: number;
    cancelledToday: number;
    completedUnpaid: number;
  };
  fares: { today: number; tipsToday: number; last7Days: number };
  attention: {
    oldestPending: ApplicationSummary[];
    stuckRides: {
      id: string;
      status: RideStatus;
      riderName: string;
      createdAt: string;
      matchedAt: string | null;
    }[];
    unpaidRides: AdminRideSummary[];
  };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ListApplicationsParams {
  status?: ApplicationStatus;
  q?: string;
  sort?: 'oldest' | 'newest';
  page?: number;
  limit?: number;
}

export interface ListRidesParams {
  /**
   * Comma-list filters (backend whitelists each value and 400s on unknowns):
   * pass several statuses at once, e.g. active = requested+matched+
   * driver_en_route+in_progress, unpaid = pending+rider_claimed+disputed+failed.
   */
  status?: RideStatus | RideStatus[];
  paymentStatus?: PaymentStatus | PaymentStatus[];
  from?: string;
  to?: string;
  q?: string;
  driverId?: string;
  riderId?: string;
  page?: number;
  limit?: number;
}

export interface AuditParams {
  action?: string;
  targetType?: 'driver' | 'ride';
  targetId?: string;
  actorUserId?: string;
  page?: number;
  limit?: number;
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
  // ── Dashboard ──
  overview: async () => (await api.get<AdminOverview>('/admin/overview')).data,

  // ── Driver applications ──
  list: async (params: ListApplicationsParams = {}) =>
    (
      await api.get<Page<ApplicationSummary>>('/admin/driver-applications', {
        params: {
          ...(params.status ? { status: params.status } : {}),
          ...(params.q ? { q: params.q } : {}),
          ...(params.sort ? { sort: params.sort } : {}),
          page: params.page ?? 1,
          limit: params.limit ?? 20,
        },
      })
    ).data,
  counts: async () => (await api.get<ApplicationCounts>('/admin/driver-applications/counts')).data,
  get: async (id: string) => (await api.get<ApplicationDetail>(`/admin/driver-applications/${id}`)).data,
  driverDetail: async (id: string) => (await api.get<DriverDetail>(`/admin/drivers/${id}`)).data,

  approve: async (id: string) => (await api.post<ApplicationDetail>(`/admin/driver-applications/${id}/approve`)).data,
  reject: async (id: string, reason: string) =>
    (await api.post<ApplicationDetail>(`/admin/driver-applications/${id}/reject`, { reason })).data,
  // reason (5–300) is required by the backend and written to the audit trail.
  suspend: async (driverId: string, reason: string, force?: boolean) =>
    (await api.post<ApplicationDetail>(`/admin/drivers/${driverId}/suspend`, { reason, ...(force ? { force } : {}) }))
      .data,
  reinstate: async (driverId: string, reason?: string) =>
    (await api.post<ApplicationDetail>(`/admin/drivers/${driverId}/reinstate`, reason ? { reason } : {})).data,

  // ── Rides ──
  listRides: async (params: ListRidesParams = {}) =>
    (
      await api.get<Page<AdminRideSummary>>('/admin/rides', {
        params: {
          ...(params.status
            ? { status: Array.isArray(params.status) ? params.status.join(',') : params.status }
            : {}),
          ...(params.paymentStatus
            ? {
                paymentStatus: Array.isArray(params.paymentStatus)
                  ? params.paymentStatus.join(',')
                  : params.paymentStatus,
              }
            : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          ...(params.q ? { q: params.q } : {}),
          ...(params.driverId ? { driverId: params.driverId } : {}),
          ...(params.riderId ? { riderId: params.riderId } : {}),
          page: params.page ?? 1,
          limit: params.limit ?? 20,
        },
      })
    ).data,
  rideDetail: async (id: string) => (await api.get<AdminRideDetail>(`/admin/rides/${id}`)).data,
  cancelRide: async (id: string, reason: string) =>
    (
      await api.post<{ id: string; status: 'cancelled'; cancelledBy: 'admin'; cancellationReason: string }>(
        `/admin/rides/${id}/cancel`,
        { reason },
      )
    ).data,
  resolvePayment: async (id: string, status: 'paid' | 'disputed', note: string) =>
    (
      await api.post<{ id: string; paymentStatus: PaymentStatus; paymentMarkedBy: PaymentMarkedBy }>(
        `/admin/rides/${id}/payment`,
        { status, note },
      )
    ).data,

  // ── Audit trail ──
  audit: async (params: AuditParams = {}) =>
    (
      await api.get<Page<AuditEntry>>('/admin/audit', {
        params: {
          ...(params.action ? { action: params.action } : {}),
          ...(params.targetType ? { targetType: params.targetType } : {}),
          ...(params.targetId ? { targetId: params.targetId } : {}),
          ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
          page: params.page ?? 1,
          limit: params.limit ?? 20,
        },
      })
    ).data,

  // ── Documents ──
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
