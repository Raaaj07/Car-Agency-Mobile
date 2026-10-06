import { csvCell, toCsv } from './csv';

/** Task 9: RFC 4180 quoting + formula-injection guard for the rides export. */
describe('csvCell', () => {
  it('passes plain values through', () => {
    expect(csvCell('Salem')).toBe('Salem');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(new Date('2026-02-01T10:00:00Z'))).toBe('2026-02-01T10:00:00.000Z');
  });

  it('renders null/undefined as empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and newlines (quotes doubled)', () => {
    expect(csvCell('12 MG Road, Salem')).toBe('"12 MG Road, Salem"');
    expect(csvCell('Vijay "V"')).toBe('"Vijay ""V"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('neutralises spreadsheet formulas but keeps plain numbers', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('@import')).toBe("'@import");
    expect(csvCell('-2+3+cmd')).toBe("'-2+3+cmd");
    // Plain numbers are not formulas — negative distances must stay intact.
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(-5.75)).toBe('-5.75');
  });
});

describe('toCsv', () => {
  it('emits BOM, CRLF rows and a trailing newline', () => {
    const csv = toCsv(['id', 'name'], [['1', 'Asha'], ['2', 'Kumar, R']]);
    expect(csv).toBe('\uFEFFid,name\r\n1,Asha\r\n2,"Kumar, R"\r\n');
  });

  it('handles an empty result set (header only)', () => {
    const csv = toCsv(['id', 'status'], []);
    expect(csv).toBe('\uFEFFid,status\r\n');
  });

  it('keeps cell order aligned with the headers', () => {
    const headers = ['a', 'b', 'c'];
    const csv = toCsv(headers, [['1', '2', '3'], ['4', '5', '6']]);
    const [headerLine, row1, row2] = csv.replace('\uFEFF', '').split('\r\n');
    expect(headerLine).toBe('a,b,c');
    expect(row1).toBe('1,2,3');
    expect(row2).toBe('4,5,6');
  });
});
