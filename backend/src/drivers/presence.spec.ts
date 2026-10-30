import {
  DEFAULT_PRESENCE_GRACE_SECONDS,
  MAX_PRESENCE_GRACE_SECONDS,
  MIN_PRESENCE_GRACE_SECONDS,
  presenceGraceMs,
} from './presence';

describe('presenceGraceMs', () => {
  it('defaults to 15 minutes when the setting is missing, blank or not a usable number', () => {
    const fifteenMinutes = 15 * 60 * 1000;
    expect(DEFAULT_PRESENCE_GRACE_SECONDS * 1000).toBe(fifteenMinutes);
    expect(presenceGraceMs(undefined)).toBe(fifteenMinutes);
    expect(presenceGraceMs(null)).toBe(fifteenMinutes);
    expect(presenceGraceMs('')).toBe(fifteenMinutes);
    expect(presenceGraceMs('soon')).toBe(fifteenMinutes);
    expect(presenceGraceMs(0)).toBe(fifteenMinutes);
    expect(presenceGraceMs(-30)).toBe(fifteenMinutes);
  });

  it('uses the configured number of seconds (env values arrive as strings)', () => {
    expect(presenceGraceMs(300)).toBe(300_000);
    expect(presenceGraceMs('600')).toBe(600_000);
  });

  it('never goes below 90 seconds (the old strict window) or above 6 hours', () => {
    expect(MIN_PRESENCE_GRACE_SECONDS).toBe(90);
    expect(presenceGraceMs(10)).toBe(90_000);
    expect(presenceGraceMs(90)).toBe(90_000);
    expect(presenceGraceMs(999_999)).toBe(MAX_PRESENCE_GRACE_SECONDS * 1000);
  });
});
