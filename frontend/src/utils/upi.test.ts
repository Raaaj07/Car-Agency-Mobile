import { buildUpiPaymentUrl, isValidUpiId } from './upi';

describe('isValidUpiId', () => {
  it('accepts a normal VPA', () => {
    expect(isValidUpiId('driver.name@okhdfcbank')).toBe(true);
    expect(isValidUpiId('  ravi_99@ybl  ')).toBe(true);
  });

  it('rejects malformed VPAs', () => {
    for (const bad of ['', 'no-at-sign', '@bank', 'a@b', 'name@bank@extra', 'na me@bank']) {
      expect(isValidUpiId(bad)).toBe(false);
    }
  });
});

describe('buildUpiPaymentUrl', () => {
  it('pre-fills the exact amount and currency', () => {
    const url = buildUpiPaymentUrl({ vpa: 'ravi@ybl', payeeName: 'Ravi', amount: 240 });
    expect(url).toBe('upi://pay?pa=ravi@ybl&pn=Ravi&am=240.00&cu=INR');
  });

  it('keeps the @ in the payee address literal (UPI apps reject %40)', () => {
    const url = buildUpiPaymentUrl({ vpa: 'ravi@ybl', payeeName: 'Ravi', amount: 10 });
    expect(url).toContain('pa=ravi@ybl');
    expect(url).not.toContain('%40');
  });

  it('encodes free text and includes the note when present', () => {
    const url = buildUpiPaymentUrl({
      vpa: 'ravi@ybl',
      payeeName: 'Ravi & Co',
      amount: 99.5,
      note: 'Ride 42',
    });
    expect(url).toContain('pn=Ravi%20%26%20Co');
    expect(url).toContain('tn=Ride%2042');
    expect(url).toContain('am=99.50');
  });

  it('never emits NaN/negative amounts', () => {
    expect(buildUpiPaymentUrl({ vpa: 'a@b', payeeName: 'A', amount: NaN })).toContain('am=0.00');
    expect(buildUpiPaymentUrl({ vpa: 'a@b', payeeName: 'A', amount: -5 })).toContain('am=0.00');
  });
});
