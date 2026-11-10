import { isoToLocalDay } from './dateInput';

describe('isoToLocalDay', () => {
  // Built from LOCAL date parts, so the expectations hold in any time zone
  // (the bug only showed in zones ahead of UTC, like India).
  it('gives the same calendar day for a promo that starts at local midnight', () => {
    const startsAt = new Date(2026, 10, 1, 0, 0, 0, 0); // 1 Nov 2026, 00:00 local
    expect(isoToLocalDay(startsAt.toISOString())).toBe('2026-11-01');
  });

  it('gives the same calendar day for a promo that ends at 23:59:59 local', () => {
    const endsAt = new Date(2026, 10, 30, 23, 59, 59, 999); // 30 Nov 2026, end of day local
    expect(isoToLocalDay(endsAt.toISOString())).toBe('2026-11-30');
  });

  it('pads single-digit months and days', () => {
    expect(isoToLocalDay(new Date(2026, 0, 5, 12, 0, 0).toISOString())).toBe('2026-01-05');
  });

  it('is empty for a missing or invalid value', () => {
    expect(isoToLocalDay(null)).toBe('');
    expect(isoToLocalDay(undefined)).toBe('');
    expect(isoToLocalDay('')).toBe('');
    expect(isoToLocalDay('not a date')).toBe('');
  });
});
