import { DEFAULT_ANNOUNCEMENT_PREFS } from './announcementPrefs';
import {
  announcementText,
  AnnouncementEvent,
  detectRideAnnouncement,
  isDriverArriving,
  languageTag,
  pickVoiceLanguage,
  shouldAnnounce,
  shouldWarnSpeed,
  snapshotRide,
  volumeLevel,
  RideSnapshot,
} from './announcements';

const ALL_EVENTS: AnnouncementEvent[] = [
  'driver_found',
  'driver_arriving',
  'trip_started',
  'trip_completed',
  'ride_cancelled',
  'no_drivers',
  'new_request',
  'request_cancelled',
  'slow_down',
];

const snap = (overrides: Partial<RideSnapshot> = {}): RideSnapshot => ({ id: 'r1', status: 'requested', ...overrides });

describe('languageTag / volumeLevel', () => {
  it('maps the language chips to a voice key', () => {
    expect(languageTag('English')).toEqual({ key: 'en', tag: 'en-IN' });
    expect(languageTag('Tamil (\u0ba4\u0bae\u0bbf\u0bb4\u0bcd)')).toEqual({ key: 'ta', tag: 'ta-IN' });
    expect(languageTag('Hindi (\u0939\u093f\u0902\u0926\u0940)')).toEqual({ key: 'hi', tag: 'hi-IN' });
    expect(languageTag('Klingon')).toEqual({ key: 'en', tag: 'en-IN' });
  });

  it('maps Soft / Normal / Loud to a volume between 0 and 1', () => {
    expect(volumeLevel('Soft')).toBe(0.4);
    expect(volumeLevel('Normal')).toBe(0.8);
    expect(volumeLevel('Loud')).toBe(1);
    expect(volumeLevel('anything else')).toBe(0.8);
  });
});

describe('pickVoiceLanguage', () => {
  it('prefers the exact India voice, then any voice of that language', () => {
    expect(pickVoiceLanguage(['en-US', 'ta-IN', 'hi-IN'], 'ta')).toBe('ta-IN');
    expect(pickVoiceLanguage(['en-US', 'en-IN'], 'en')).toBe('en-IN');
    expect(pickVoiceLanguage(['en-US', 'hi-XX'], 'hi')).toBe('hi-XX');
    expect(pickVoiceLanguage(['en_IN'], 'en')).toBe('en-IN');
  });

  it('returns null when the phone has no voice for the language', () => {
    expect(pickVoiceLanguage(['en-US', 'hi-IN'], 'ta')).toBeNull();
  });

  it('trusts the preferred tag when the phone could not list its voices', () => {
    expect(pickVoiceLanguage([], 'ta')).toBe('ta-IN');
  });
});

describe('announcementText', () => {
  it('has a non-empty sentence for every event in every language', () => {
    for (const key of ['en', 'ta', 'hi'] as const) {
      for (const event of ALL_EVENTS) {
        expect(announcementText(event, key, { driverName: 'Ravi', fare: 240, km: 5.2 }).length).toBeGreaterThan(5);
      }
    }
  });

  it('English: names the driver and reads the fare in whole rupees', () => {
    expect(announcementText('driver_found', 'en', { driverName: ' Ravi ' })).toBe('Your driver Ravi is on the way.');
    expect(announcementText('driver_found', 'en')).toBe('Your driver is on the way.');
    expect(announcementText('trip_completed', 'en', { fare: 239.6 })).toBe(
      'You have reached your destination. The total fare is 240 rupees.',
    );
    expect(announcementText('trip_completed', 'en')).toBe('You have reached your destination.');
  });

  it('a new ride request reads the distance and fare when known', () => {
    expect(announcementText('new_request', 'en', { km: 5.24, fare: 240 })).toBe(
      'New ride request. 5.2 kilometres. Fare 240 rupees.',
    );
    expect(announcementText('new_request', 'en')).toBe('New ride request.');
  });

  it('Tamil and Hindi carry the driver name and fare', () => {
    expect(announcementText('driver_found', 'ta', { driverName: 'Ravi' })).toContain('Ravi');
    expect(announcementText('trip_completed', 'ta', { fare: 240 })).toContain('240');
    expect(announcementText('driver_found', 'hi', { driverName: 'Ravi' })).toContain('Ravi');
    expect(announcementText('trip_completed', 'hi', { fare: 240 })).toContain('240');
  });

  it('ignores a fare that is not a usable number', () => {
    expect(announcementText('trip_completed', 'en', { fare: Number.NaN })).toBe('You have reached your destination.');
    expect(announcementText('trip_completed', 'en', { fare: -5 })).toBe('You have reached your destination.');
  });
});

describe('shouldAnnounce (settings gate)', () => {
  const on = { ...DEFAULT_ANNOUNCEMENT_PREFS, voiceAlerts: true, arrivalChime: true, speedAlerts: true };

  it('the master switch mutes everything', () => {
    const off = { ...on, voiceAlerts: false };
    for (const event of ALL_EVENTS) expect(shouldAnnounce(off, event)).toBe(false);
  });

  it('the arrival alert and the speed warning need their own switch', () => {
    expect(shouldAnnounce({ ...on, arrivalChime: false }, 'driver_arriving')).toBe(false);
    expect(shouldAnnounce({ ...on, arrivalChime: false }, 'driver_found')).toBe(true);
    expect(shouldAnnounce({ ...on, speedAlerts: false }, 'slow_down')).toBe(false);
    expect(shouldAnnounce({ ...on, speedAlerts: false }, 'trip_started')).toBe(true);
    expect(shouldAnnounce(on, 'slow_down')).toBe(true);
  });
});

describe('snapshotRide', () => {
  it('keeps only what the rules need, with numbers parsed', () => {
    expect(
      snapshotRide({
        id: 'r1',
        status: 'completed',
        driver: { name: ' Ravi ' },
        fareBreakdown: { total: '240' },
        distanceKm: '5.2',
      }),
    ).toEqual({
      id: 'r1',
      status: 'completed',
      source: undefined,
      cancellationReason: undefined,
      driverName: 'Ravi',
      fare: 240,
      km: 5.2,
    });
    expect(snapshotRide(null)).toBeNull();
  });
});

describe('detectRideAnnouncement - rider', () => {
  it('announces when a driver is found, with the name', () => {
    const result = detectRideAnnouncement(snap(), snap({ status: 'matched', driverName: 'Ravi' }), 'rider');
    expect(result).toEqual({ event: 'driver_found', rideId: 'r1', params: { driverName: 'Ravi' } });
  });

  it('announces trip start, trip end (with the fare) and cancellation', () => {
    expect(detectRideAnnouncement(snap({ status: 'driver_en_route' }), snap({ status: 'in_progress' }), 'rider')?.event).toBe(
      'trip_started',
    );
    expect(
      detectRideAnnouncement(snap({ status: 'in_progress' }), snap({ status: 'completed', fare: 240 }), 'rider'),
    ).toEqual({ event: 'trip_completed', rideId: 'r1', params: { fare: 240 } });
    expect(detectRideAnnouncement(snap({ status: 'matched' }), snap({ status: 'cancelled' }), 'rider')?.event).toBe(
      'ride_cancelled',
    );
  });

  it('says "no drivers" when the system cancelled a search with nobody found', () => {
    const result = detectRideAnnouncement(
      snap(),
      snap({ status: 'cancelled', cancellationReason: 'no_drivers_available' }),
      'rider',
    );
    expect(result?.event).toBe('no_drivers');
  });

  it('stays silent for a ride seen for the first time (a booking just made, or a resume)', () => {
    expect(detectRideAnnouncement(null, snap({ status: 'driver_en_route' }), 'rider')).toBeNull();
    expect(detectRideAnnouncement(snap({ id: 'old', status: 'completed' }), snap({ id: 'new', status: 'in_progress' }), 'rider')).toBeNull();
  });

  it('stays silent when nothing changed or the change is not an announcement', () => {
    expect(detectRideAnnouncement(snap({ status: 'matched' }), snap({ status: 'matched' }), 'rider')).toBeNull();
    expect(detectRideAnnouncement(snap({ status: 'matched' }), snap({ status: 'driver_en_route' }), 'rider')).toBeNull();
    expect(detectRideAnnouncement(snap({ status: 'completed' }), snap({ status: 'cancelled' }), 'rider')).toBeNull();
    expect(detectRideAnnouncement(snap({ status: 'in_progress' }), null, 'rider')).toBeNull();
  });
});

describe('detectRideAnnouncement - driver', () => {
  it('announces a new offer with its distance and fare', () => {
    const result = detectRideAnnouncement(null, snap({ fare: 240, km: 5.2 }), 'driver');
    expect(result).toEqual({ event: 'new_request', rideId: 'r1', params: { fare: 240, km: 5.2 } });
  });

  it('announces a different offer that follows another ride', () => {
    expect(detectRideAnnouncement(snap({ id: 'a', status: 'completed' }), snap({ id: 'b' }), 'driver')?.event).toBe('new_request');
  });

  it('does not repeat for the same offer, and never for the rider\u2019s own booking', () => {
    expect(detectRideAnnouncement(snap(), snap(), 'driver')).toBeNull();
    expect(detectRideAnnouncement(null, snap({ source: 'rider-restore' }), 'driver')).toBeNull();
  });

  it('is silent for status changes of an accepted ride', () => {
    expect(detectRideAnnouncement(snap(), snap({ status: 'matched' }), 'driver')).toBeNull();
    expect(detectRideAnnouncement(snap({ status: 'matched' }), snap({ status: 'in_progress' }), 'driver')).toBeNull();
  });
});

describe('isDriverArriving', () => {
  it('is true within 300 m or within a minute of the pickup', () => {
    expect(isDriverArriving(250, null)).toBe(true);
    expect(isDriverArriving(2000, 45)).toBe(true);
    expect(isDriverArriving(300, 500)).toBe(true);
  });

  it('is false while far away or without data', () => {
    expect(isDriverArriving(2000, 400)).toBe(false);
    expect(isDriverArriving(null, null)).toBe(false);
    expect(isDriverArriving(undefined, undefined)).toBe(false);
    expect(isDriverArriving(Number.NaN, Number.NaN)).toBe(false);
  });
});

describe('shouldWarnSpeed', () => {
  it('warns above the limit, but not at or below it', () => {
    expect(shouldWarnSpeed(95, 100_000, 0)).toBe(true);
    expect(shouldWarnSpeed(80, 100_000, 0)).toBe(false);
    expect(shouldWarnSpeed(40, 100_000, 0)).toBe(false);
  });

  it('does not repeat within the cooldown', () => {
    expect(shouldWarnSpeed(95, 100_000, 80_000)).toBe(false);
    expect(shouldWarnSpeed(95, 111_000, 80_000)).toBe(true);
  });

  it('ignores a missing or invalid speed', () => {
    expect(shouldWarnSpeed(null, 100_000, 0)).toBe(false);
    expect(shouldWarnSpeed(undefined, 100_000, 0)).toBe(false);
    expect(shouldWarnSpeed(Number.NaN, 100_000, 0)).toBe(false);
  });
});
