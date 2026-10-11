import { last4, maskEmail, maskPhone } from './log-hygiene';

/**
 * Pass-4 (task 13): log-hygiene helpers. These keep a recognisable tail so
 * support can still correlate a log line with a user, without shipping a full
 * phone number / email into log drains.
 */
describe('log-hygiene (pass-4 task-13)', () => {
  it('last4 returns only the final four digits', () => {
    expect(last4('9876543210')).toBe('3210');
    expect(last4('+91 98765 43210')).toBe('3210');
  });

  it('last4 never returns a full number for short/empty input', () => {
    expect(last4('')).toBe('');
    expect(last4(null)).toBe('');
    expect(last4('12')).toBe('••');
  });

  it('maskPhone keeps the first 3 and last 2, dotting the middle', () => {
    expect(maskPhone('9876543210')).toBe('987•••••10');
  });

  it('maskPhone handles short and empty input without leaking digits', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
    expect(maskPhone('1234')).toBe('••••');
  });

  it('maskEmail hides the local part and the host label, keeping the TLD', () => {
    const masked = maskEmail('someone@example.com');
    expect(masked).toBe('s***@e***.com');
    expect(masked).not.toContain('someone');
    expect(masked).not.toContain('example');
  });

  it('maskEmail never echoes non-email input verbatim', () => {
    expect(maskEmail('not-an-email')).toMatch(/^•+$/);
    expect(maskEmail('')).toBe('•'.repeat(8));
  });
});
