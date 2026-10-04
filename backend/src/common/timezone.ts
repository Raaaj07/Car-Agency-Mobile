import { ConfigService } from '@nestjs/config';

/**
 * R-6: "today" for earnings/stats must be the operator's day (IST), not the
 * server's UTC day — otherwise the counter resets at 05:30 IST.
 */
export const DEFAULT_APP_TIMEZONE = 'Asia/Kolkata';

export function appTimezone(config: ConfigService): string {
  const tz = (config.get<string>('APP_TIMEZONE') ?? '').trim();
  return tz || DEFAULT_APP_TIMEZONE;
}

/**
 * UTC instant of local midnight for the calendar day that contains `date` in
 * `timeZone` (no dependencies, works for fixed-offset zones like Asia/Kolkata).
 */
export function zonedStartOfDay(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  // Wall-clock time read in `timeZone`, expressed as if it were UTC…
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // …minus the actual (sub-second-truncated) instant, gives the zone offset.
  const offsetMs = wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
  // Local midnight as a wall-clock instant, converted back to real UTC.
  return new Date(Date.UTC(year, month - 1, day) - offsetMs);
}

/** Start of the day `days` days before the day containing `date`. */
export function zonedStartOfDayAgo(date: Date, days: number, timeZone: string): Date {
  const shift = Math.max(0, Math.trunc(days)) * 24 * 60 * 60 * 1000;
  return zonedStartOfDay(new Date(date.getTime() - shift), timeZone);
}
