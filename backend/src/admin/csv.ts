/**
 * Task 9: CSV helpers for GET /admin/rides/export.csv.
 *
 * RFC 4180 quoting (commas, quotes, CR/LF get wrapped; quotes doubled) plus a
 * spreadsheet formula-injection guard: a cell starting with `=`, `+`, `@` or
 * `-` is prefixed with a single quote so Excel/Sheets won't execute it —
 * unless the value is a plain number (`-5` stays `-5`).
 */
export type CsvValue = string | number | boolean | Date | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value == null) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Full CSV document: BOM (so Excel detects UTF-8 for non-ASCII addresses),
 * CRLF line endings and a trailing newline.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
