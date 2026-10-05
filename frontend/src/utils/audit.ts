import { AuditAction } from '../api/admin';

/**
 * Human labels for audit actions — used by the Overview "Recent activity"
 * feed and the driver detail "Review history" (spec §3.2).
 */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  approve: 'Approved application',
  reject: 'Rejected application',
  suspend: 'Suspended driver',
  reinstate: 'Reinstated driver',
  ride_cancel: 'Cancelled ride',
  payment_resolve: 'Resolved payment',
};
