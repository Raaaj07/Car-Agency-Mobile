import { formatDistance, haversineKm } from './distance';

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm({ lat: 12.9, lng: 77.6 }, { lat: 12.9, lng: 77.6 })).toBeCloseTo(0, 6);
  });

  it('matches a known city-pair distance (~350 km Bengaluru–Chennai)', () => {
    const km = haversineKm({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 });
    expect(km).toBeGreaterThan(280);
    expect(km).toBeLessThan(310);
  });

  it('is symmetric', () => {
    const a = { lat: 12.9, lng: 77.6 };
    const b = { lat: 13.1, lng: 77.4 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe('formatDistance', () => {
  it('uses metres under 1 km, rounded to 50 m', () => {
    expect(formatDistance(0.05)).toBe('<100 m');
    expect(formatDistance(0.3)).toBe('300 m');
  });

  it('uses one decimal under 10 km, whole km above', () => {
    expect(formatDistance(2.34)).toBe('2.3 km');
    expect(formatDistance(14.6)).toBe('15 km');
  });

  it('returns null for unknown/invalid distances', () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance(NaN)).toBeNull();
    expect(formatDistance(-1)).toBeNull();
  });
});
