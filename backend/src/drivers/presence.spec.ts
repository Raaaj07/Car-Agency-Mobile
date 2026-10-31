import {
  DEFAULT_PRESENCE_GRACE_SECONDS,
  MAX_PRESENCE_GRACE_SECONDS,
  MIN_PRESENCE_GRACE_SECONDS,
  presenceGraceMs,
} from './presence';

describe('presenceGraceMs', () => {
  it('defaults to 5 minutes when the setting is missing, blank or not a usable number', () => {
    const fiveMinutes = 5 * 60 * 1000;
    expect(DEFAULT_PRESENCE_GRACE_SECONDS * 1000).toBe(fiveMinutes);
    expect(presenceGraceMs(undefined)).toBe(fiveMinutes);
    expect(presenceGraceMs(null)).toBe(fiveMinutes);
    expect(presenceGraceMs('')).toBe(fiveMinutes);
    expect(presenceGraceMs('soon')).toBe(fiveMinutes);
    expect(presenceGraceMs(0)).toBe(fiveMinutes);
    expect(presenceGraceMs(-30)).toBe(fiveMinutes);
  });

  it('uses the configured number of seconds (env values arrive as strings)', () => {
    expect(presenceGraceMs(120)).toBe(120_000);
    expect(presenceGraceMs('900')).toBe(900_000);
  });

  it('never goes below 90 seconds (the old strict window) or above 6 hours', () => {
    expect(MIN_PRESENCE_GRACE_SECONDS).toBe(90);
    expect(presenceGraceMs(10)).toBe(90_000);
    expect(presenceGraceMs(90)).toBe(90_000);
    expect(presenceGraceMs(999_999)).toBe(MAX_PRESENCE_GRACE_SECONDS * 1000);
  });
});
