import { zonedStartOfDay, zonedStartOfDayAgo } from './timezone';

/**
 * R-6: "today" must start at local midnight in the operator's timezone —
 * the old UTC boundary reset earnings at 05:30 IST.
 */
describe('zonedStartOfDay (R-6)', () => {
  it('maps mid-day UTC to the previous IST midnight boundary', () => {
    // 2026-01-14T12:00:00Z = 17:30 IST on Jan 14 → the IST day began 18:30Z.
    expect(zonedStartOfDay(new Date('2026-01-14T12:00:00Z'), 'Asia/Kolkata').toISOString()).toBe(
      '2026-01-13T18:30:00.000Z',
    );
  });

  it('treats the exact IST midnight instant as the start of the new day', () => {
    // 2026-01-14T18:30:00Z = exactly 00:00:00 IST on Jan 15.
    expect(zonedStartOfDay(new Date('2026-01-14T18:30:00Z'), 'Asia/Kolkata').toISOString()).toBe(
      '2026-01-14T18:30:00.000Z',
    );
    // One second earlier is still Jan 14 in IST (23:59:59).
    expect(zonedStartOfDay(new Date('2026-01-14T18:29:59Z'), 'Asia/Kolkata').toISOString()).toBe(
      '2026-01-13T18:30:00.000Z',
    );
  });

  it('handles UTC identically to a plain date boundary', () => {
    expect(zonedStartOfDay(new Date('2026-01-14T12:00:00Z'), 'UTC').toISOString()).toBe(
      '2026-01-14T00:00:00.000Z',
    );
  });

  it('zonedStartOfDayAgo shifts whole local days', () => {
    // 7 days before the IST day containing 2026-01-14T12:00Z (= Jan 14 IST)
    // → IST midnight of Jan 7 = 2026-01-06T18:30:00Z.
    expect(zonedStartOfDayAgo(new Date('2026-01-14T12:00:00Z'), 7, 'Asia/Kolkata').toISOString()).toBe(
      '2026-01-06T18:30:00.000Z',
    );
  });
});
