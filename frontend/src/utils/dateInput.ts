/**
 * Date-only text fields (admin promo form: "valid from" / "valid until").
 * Pure, so it runs in plain Jest.
 */

/**
 * "YYYY-MM-DD" of the LOCAL calendar day an ISO timestamp falls on, or '' for
 * a missing / invalid value.
 *
 * The promo form turns a typed day into local midnight (start) or 23:59:59
 * (end) and the server stores that instant as UTC. Cutting the ISO string's
 * first 10 characters instead of reading the local day showed the PREVIOUS day
 * for any start date in a time zone ahead of UTC (India is UTC+5:30), so each
 * edit-and-save moved the start of the promo a day earlier.
 */
export function isoToLocalDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
