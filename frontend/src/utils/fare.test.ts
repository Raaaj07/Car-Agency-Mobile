import { estimateFareTotal, estimateNumericPrice } from './fare';

describe('estimateNumericPrice (mirrors backend computeNumericPrice)', () => {
  it('a 5 km trip costs the reference price for every vehicle', () => {
    expect(estimateNumericPrice('auto', 5)).toBe(110);
    expect(estimateNumericPrice('mini', 5)).toBe(180);
    expect(estimateNumericPrice('sedan', 5)).toBe(240);
    expect(estimateNumericPrice('suv', 5)).toBe(350);
  });

  it('scales with the distance', () => {
    expect(estimateNumericPrice('sedan', 10)).toBe(480);
    expect(estimateNumericPrice('auto', 12)).toBe(264);
    expect(estimateNumericPrice('suv', 7.3)).toBe(511);
  });

  it('a short trip never drops below 60% of the reference price', () => {
    expect(estimateNumericPrice('sedan', 1)).toBe(144);
    expect(estimateNumericPrice('auto', 0.2)).toBe(66);
    expect(estimateNumericPrice('mini', 0)).toBe(108);
  });

  it('returns null when the vehicle is unknown or the distance is not usable', () => {
    expect(estimateNumericPrice('spaceship', 5)).toBeNull();
    expect(estimateNumericPrice('sedan', null)).toBeNull();
    expect(estimateNumericPrice('sedan', undefined)).toBeNull();
    expect(estimateNumericPrice('sedan', Number.NaN)).toBeNull();
    expect(estimateNumericPrice('sedan', -3)).toBeNull();
  });
});

describe('estimateFareTotal (mirrors backend computeFareBreakdown)', () => {
  it('adds the fixed toll and taxes to the 50/30/10 split', () => {
    expect(estimateFareTotal(240)).toBe(284);
    expect(estimateFareTotal(110)).toBe(167);
  });

  it('subtracts a promo discount but never goes below zero', () => {
    expect(estimateFareTotal(240, 20)).toBe(264);
    expect(estimateFareTotal(10, 500)).toBe(0);
  });
});
