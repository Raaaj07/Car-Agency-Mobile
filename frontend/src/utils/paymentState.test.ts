import { driverPaymentBadge } from './paymentState';

describe('driverPaymentBadge', () => {
  it('a paid trip shows Received and offers no action', () => {
    expect(driverPaymentBadge('paid')).toEqual({ label: 'Received', variant: 'success', canMarkReceived: false });
  });

  it('a pending or rider-claimed trip can be marked received', () => {
    expect(driverPaymentBadge('pending')).toMatchObject({ label: 'Unpaid', canMarkReceived: true });
    expect(driverPaymentBadge('rider_claimed')).toMatchObject({ label: 'Rider says paid', canMarkReceived: true });
  });

  it('a disputed or failed payment is left to the admin', () => {
    expect(driverPaymentBadge('disputed')).toMatchObject({ variant: 'danger', canMarkReceived: false });
    expect(driverPaymentBadge('failed')).toMatchObject({ variant: 'danger', canMarkReceived: false });
  });

  it('an unknown or missing status is treated as unpaid', () => {
    expect(driverPaymentBadge(undefined)).toMatchObject({ label: 'Unpaid', canMarkReceived: true });
    expect(driverPaymentBadge(null)).toMatchObject({ label: 'Unpaid', canMarkReceived: true });
    expect(driverPaymentBadge('something_new')).toMatchObject({ label: 'Unpaid', canMarkReceived: true });
  });
});
