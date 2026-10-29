import { formatDateIST, formatDateTimeIST, inr, maskPhone, timeAgo } from './format';

describe('inr', () => {
  it('uses Indian digit grouping and rounds to whole rupees by default', () => {
    expect(inr(123456.7)).toBe('₹1,23,457');
    expect(inr(240)).toBe('₹240');
  });

  it('shows paise only when asked', () => {
    expect(inr(240.5, { decimals: true })).toBe('₹240.50');
  });

  it('treats a non-finite amount as zero', () => {
    expect(inr(NaN)).toBe('₹0');
    expect(inr(Infinity)).toBe('₹0');
  });
});

describe('maskPhone', () => {
  it('never exposes the full number', () => {
    expect(maskPhone('+91 98765 43210')).toBe('919•••••10');
  });

  it('handles empty/short values safely', () => {
    expect(maskPhone(null)).toBe('');
    expect(maskPhone('123')).toBe('•••');
  });
});

describe('IST date formatting', () => {
  it('renders UTC input in Asia/Kolkata', () => {
    // 2026-10-04T17:15:00Z == 22:45 IST.
    expect(formatDateTimeIST('2026-10-04T17:15:00.000Z')).toContain('04 Oct 2026');
    expect(formatDateTimeIST('2026-10-04T17:15:00.000Z')).toMatch(/10:45\s?pm/i);
    expect(formatDateIST('2026-10-04T17:15:00.000Z')).toBe('04 Oct 2026');
  });

  it('returns an em dash for missing/invalid values', () => {
    expect(formatDateIST(null)).toBe('—');
    expect(formatDateTimeIST('not-a-date')).toBe('—');
  });
});

describe('timeAgo', () => {
  const at = (msAgo: number) => new Date(Date.now() - msAgo);

  it('scales from seconds to days', () => {
    expect(timeAgo(at(5_000))).toBe('just now');
    expect(timeAgo(at(5 * 60_000))).toBe('5m ago');
    expect(timeAgo(at(3 * 3_600_000))).toBe('3h ago');
    expect(timeAgo(at(2 * 86_400_000))).toBe('2d ago');
  });

  it('can omit the suffix for durations', () => {
    expect(timeAgo(at(3 * 3_600_000), { suffix: false })).toBe('3h');
  });

  it('never reports a negative age (clock skew)', () => {
    expect(timeAgo(new Date(Date.now() + 60_000))).toBe('just now');
  });
});
