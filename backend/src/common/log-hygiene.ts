/**
 * Pass-4 (task 13): logging hygiene. Log lines must never carry a full phone
 * number, email or token — proxies, error reporters and log drains keep them
 * far longer than the OTP they were debugging was worth. These helpers keep a
 * recognisable tail (so a support engineer can still match a log line to a
 * user) without shipping the identifier itself.
 */

/** Last N digits of a phone, e.g. "•••••1234". Empty input stays empty. */
export function last4(phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '•'.repeat(digits.length);
}

/**
 * Ride list/detail never expose raw phone numbers — only this masked form
 * ("987•••••10"). Shared so the admin console and any future surface agree.
 */
export function maskPhone(phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 5) return '•'.repeat(digits.length);
  return `${digits.slice(0, 3)}•••••${digits.slice(-2)}`;
}

/**
 * email -> "a***@e***.com" — keeps the domain (useful for spotting
 * throwaway-domain abuse) while hiding the local part and the host's first
 * label. Non-email input is masked to dots so nothing leaks by accident.
 */
export function maskEmail(email?: string | null): string {
  const value = (email ?? '').trim();
  if (!value || !value.includes('@')) return '•'.repeat(value.length || 8);
  const [local = '', host = ''] = value.split('@');
  const dot = host.lastIndexOf('.');
  const tld = dot > 0 ? host.slice(dot) : '';
  const hostHead = dot > 0 ? host.slice(0, dot) : host;
  return `${local.slice(0, 1)}***@${hostHead.slice(0, 1)}***${tld}`;
}
