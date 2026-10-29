import { tripDurationMinutes } from './tripTime';

describe('tripDurationMinutes', () => {
  it('measures from trip start to completion, in whole minutes', () => {
    expect(tripDurationMinutes('2026-10-29T10:00:00Z', '2026-10-29T10:18:00Z')).toBe(18);
    expect(tripDurationMinutes('2026-10-29T10:00:00Z', '2026-10-29T10:18:40Z')).toBe(19);
  });

  it('never shows less than 1 minute for a real trip', () => {
    expect(tripDurationMinutes('2026-10-29T10:00:00Z', '2026-10-29T10:00:10Z')).toBe(1);
  });

  it('returns null when a time is missing (older trips without startedAt)', () => {
    expect(tripDurationMinutes(null, '2026-10-29T10:18:00Z')).toBeNull();
    expect(tripDurationMinutes(undefined, '2026-10-29T10:18:00Z')).toBeNull();
    expect(tripDurationMinutes('2026-10-29T10:00:00Z', null)).toBeNull();
  });

  it('returns null for unusable or backwards times', () => {
    expect(tripDurationMinutes('not a date', '2026-10-29T10:18:00Z')).toBeNull();
    expect(tripDurationMinutes('2026-10-29T10:18:00Z', '2026-10-29T10:00:00Z')).toBeNull();
    expect(tripDurationMinutes('2026-10-29T10:00:00Z', '2026-10-29T10:00:00Z')).toBeNull();
  });
});
