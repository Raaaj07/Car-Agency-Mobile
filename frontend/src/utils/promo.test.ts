import { normalizePromoCode, promoCodeProblem, promoDecision } from './promo';

describe('normalizePromoCode', () => {
  it('trims and upper-cases what the rider typed', () => {
    expect(normalizePromoCode('  vazhi20 ')).toBe('VAZHI20');
    expect(normalizePromoCode('Festive50')).toBe('FESTIVE50');
    expect(normalizePromoCode('   ')).toBe('');
  });
});

describe('promoCodeProblem', () => {
  it('asks for a code when the field is empty', () => {
    expect(promoCodeProblem('')).toBe('Enter a promo code.');
  });

  it('rejects text that can not be a code without asking the server', () => {
    expect(promoCodeProblem('AB')).toMatch(/3 to 30/);
    expect(promoCodeProblem('X'.repeat(31))).toMatch(/3 to 30/);
  });

  it('accepts a code of 3 to 30 characters', () => {
    expect(promoCodeProblem('ABC')).toBeNull();
    expect(promoCodeProblem('VAZHI20')).toBeNull();
    expect(promoCodeProblem('X'.repeat(30))).toBeNull();
  });
});

describe('promoDecision', () => {
  it('applies a valid code with the amount the server returned', () => {
    expect(promoDecision({ valid: true, discountAmount: 50, message: 'Code applied!' }, 'FESTIVE50')).toEqual({
      ok: true,
      code: 'FESTIVE50',
      discountAmount: 50,
    });
  });

  it('shows the server message for an invalid code (expired, used, first ride only...)', () => {
    expect(
      promoDecision({ valid: false, discountAmount: 0, message: 'Promo code "OLD10" has expired.' }, 'OLD10'),
    ).toEqual({ ok: false, message: 'Promo code "OLD10" has expired.' });
  });

  it('falls back to a plain message when the server sent none', () => {
    expect(promoDecision({ valid: false, discountAmount: 0, message: '  ' }, 'ABC')).toEqual({
      ok: false,
      message: 'This promo code can not be applied.',
    });
  });

  it('never applies a "valid" answer with an unusable amount', () => {
    expect(promoDecision({ valid: true, discountAmount: Number.NaN, message: 'ok' }, 'ABC').ok).toBe(false);
    expect(promoDecision({ valid: true, discountAmount: -5, message: 'ok' }, 'ABC').ok).toBe(false);
  });

  it('rounds the amount to whole rupees', () => {
    expect(promoDecision({ valid: true, discountAmount: 19.6, message: '' }, 'ABC')).toEqual({
      ok: true,
      code: 'ABC',
      discountAmount: 20,
    });
  });
});
