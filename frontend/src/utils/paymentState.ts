/**
 * How a completed trip's payment looks to the DRIVER in the Trips list, and
 * whether the driver may still tap "Amount Received" for it.
 *
 * The server is the real gatekeeper (it refuses a disputed ride and treats a
 * second tap on a paid ride as a no-op); this only decides what to show.
 * `failed` (a failed gateway check) and `disputed` are left to the admin.
 */
export interface DriverPaymentBadge {
  label: string;
  variant: 'success' | 'danger' | 'warning';
  canMarkReceived: boolean;
}

export function driverPaymentBadge(status: string | null | undefined): DriverPaymentBadge {
  switch (status) {
    case 'paid':
      return { label: 'Received', variant: 'success', canMarkReceived: false };
    case 'disputed':
      return { label: 'Disputed', variant: 'danger', canMarkReceived: false };
    case 'failed':
      return { label: 'Payment failed', variant: 'danger', canMarkReceived: false };
    case 'rider_claimed':
      return { label: 'Rider says paid', variant: 'warning', canMarkReceived: true };
    case 'pending':
    default:
      return { label: 'Unpaid', variant: 'warning', canMarkReceived: true };
  }
}
