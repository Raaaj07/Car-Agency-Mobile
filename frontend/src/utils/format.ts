/**
 * Display formatting shared by the admin console (and available to rider/
 * driver screens). All dates render in IST (Asia/Kolkata) — never the device
 * timezone or the server's UTC (spec §2).
 */

const IST = 'Asia/Kolkata';

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** ₹ with Indian digit grouping: inr(123456.7) → "₹1,23,457". */
export function inr(amount: number, opts?: { decimals?: boolean }): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const formatted = opts?.decimals
    ? value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(value).toLocaleString('en-IN');
  return `₹${formatted}`;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "04 Oct 2026, 10:45 pm" in IST. "—" for missing/invalid values. */
export function formatDateTimeIST(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? dateTimeFormatter.format(d) : '—';
}

/** "04 Oct 2026" in IST. "—" for missing/invalid values. */
export function formatDateIST(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? dateFormatter.format(d) : '—';
}

/** Compact relative age: "just now", "5m ago", "3h ago", "2d ago".
 *  Pass `{ suffix: false }` for durations ("5m", "2d") as in "Waiting 2d". */
export function timeAgo(value: string | Date | null | undefined, opts?: { suffix?: boolean }): string {
  const suffix = opts?.suffix ?? true;
  const d = toDate(value);
  if (!d) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return suffix ? 'just now' : 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return suffix ? `${minutes}m ago` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return suffix ? `${hours}h ago` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return suffix ? `${days}d ago` : `${days}d`;
}

/** "987•••••10" — ride lists/details never show full phone numbers. */
export function maskPhone(phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 5) return '•'.repeat(digits.length);
  return `${digits.slice(0, 3)}•••••${digits.slice(-2)}`;
}
