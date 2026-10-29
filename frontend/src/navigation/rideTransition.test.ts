import { nextRideAction } from './rideTransition';

describe('nextRideAction - no status', () => {
  it('does nothing without a status', () => {
    expect(nextRideAction('FindingDriver', undefined)).toBe('none');
    expect(nextRideAction('TripProgress', '')).toBe('none');
  });
});

describe('nextRideAction - FindingDriver (searching)', () => {
  it('stays while the ride is still being searched', () => {
    expect(nextRideAction('FindingDriver', 'requested')).toBe('none');
  });

  it('advances when a driver was found', () => {
    expect(nextRideAction('FindingDriver', 'matched')).toBe('advance');
    expect(nextRideAction('FindingDriver', 'driver_en_route')).toBe('advance');
  });

  it('advances when the ride moved past "matched" while backgrounded', () => {
    expect(nextRideAction('FindingDriver', 'in_progress')).toBe('advance');
    expect(nextRideAction('FindingDriver', 'completed')).toBe('advance');
  });

  it('goes to the outcome screen when cancelled while backgrounded', () => {
    expect(nextRideAction('FindingDriver', 'cancelled')).toBe('cancel');
  });
});

describe('nextRideAction - YouGotTheRide (driver assigned)', () => {
  it('stays while matched or en route', () => {
    expect(nextRideAction('YouGotTheRide', 'requested')).toBe('none');
    expect(nextRideAction('YouGotTheRide', 'matched')).toBe('none');
    expect(nextRideAction('YouGotTheRide', 'driver_en_route')).toBe('none');
  });

  it('advances once the trip started or finished meanwhile', () => {
    expect(nextRideAction('YouGotTheRide', 'in_progress')).toBe('advance');
    expect(nextRideAction('YouGotTheRide', 'completed')).toBe('advance');
  });

  it('goes to the outcome screen when cancelled while backgrounded', () => {
    expect(nextRideAction('YouGotTheRide', 'cancelled')).toBe('cancel');
  });
});

describe('nextRideAction - DriverEnRoute (driver on the way)', () => {
  it('stays until the driver enters the pickup OTP', () => {
    expect(nextRideAction('DriverEnRoute', 'matched')).toBe('none');
    expect(nextRideAction('DriverEnRoute', 'driver_en_route')).toBe('none');
  });

  it('starts the trip screen when the OTP was verified meanwhile', () => {
    expect(nextRideAction('DriverEnRoute', 'in_progress')).toBe('advance');
  });

  it('goes to review when the trip was completed while backgrounded', () => {
    expect(nextRideAction('DriverEnRoute', 'completed')).toBe('complete');
  });

  it('goes to the outcome screen when cancelled while backgrounded', () => {
    expect(nextRideAction('DriverEnRoute', 'cancelled')).toBe('cancel');
  });
});

describe('nextRideAction - TripProgress (trip running)', () => {
  it('stays while the trip is running', () => {
    expect(nextRideAction('TripProgress', 'in_progress')).toBe('none');
  });

  it('goes to review when the trip was completed while backgrounded', () => {
    expect(nextRideAction('TripProgress', 'completed')).toBe('complete');
  });

  it('goes to the outcome screen when cancelled while backgrounded', () => {
    expect(nextRideAction('TripProgress', 'cancelled')).toBe('cancel');
  });

  it('ignores a stale earlier status', () => {
    expect(nextRideAction('TripProgress', 'matched')).toBe('none');
  });
});

describe('nextRideAction - an unknown status never moves the rider', () => {
  it('returns none on every screen', () => {
    for (const screen of ['FindingDriver', 'YouGotTheRide', 'DriverEnRoute', 'TripProgress'] as const) {
      expect(nextRideAction(screen, 'something_new')).toBe('none');
    }
  });
});
