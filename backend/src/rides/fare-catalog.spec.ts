import { computeFareBreakdown, computeNumericPrice } from './fare-catalog';

describe('computeFareBreakdown (no flat toll, no flat taxes)', () => {
  it('splits the trip price 50 / 30 / 20 and charges exactly the trip price', () => {
    expect(computeFareBreakdown(240, 0)).toEqual({
      baseFare: 120,
      distanceFare: 72,
      timeCharge: 48,
      tollFee: 0,
      taxes: 0,
      discount: 0,
      total: 240,
    });
  });

  it('the three parts always add up to the trip price exactly (rounding goes to the time charge)', () => {
    for (let price = 1; price <= 2000; price += 1) {
      const fare = computeFareBreakdown(price, 0);
      expect(fare.baseFare + fare.distanceFare + fare.timeCharge).toBe(price);
      expect(fare.total).toBe(price);
      expect(fare.tollFee).toBe(0);
      expect(fare.taxes).toBe(0);
    }
  });

  it('subtracts a promo discount and never goes below zero', () => {
    expect(computeFareBreakdown(240, 20).total).toBe(220);
    expect(computeFareBreakdown(240, 20).discount).toBe(20);
    expect(computeFareBreakdown(10, 500).total).toBe(0);
  });

  it('a 5 km trip costs the reference price of each vehicle', () => {
    expect(computeFareBreakdown(computeNumericPrice('auto', 5), 0).total).toBe(110);
    expect(computeFareBreakdown(computeNumericPrice('sedan', 5), 0).total).toBe(240);
  });
});
