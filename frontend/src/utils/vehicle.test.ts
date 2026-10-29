import { vehicleName } from './vehicle';

describe('vehicleName', () => {
  it('names every vehicle type the app books', () => {
    expect(vehicleName('auto')).toBe('Vazhi Auto');
    expect(vehicleName('mini')).toBe('Economy Mini');
    expect(vehicleName('sedan')).toBe('Comfort Sedan');
    expect(vehicleName('suv')).toBe('Premium SUV');
  });

  it('returns null for a missing or unknown type so the caller can fall back', () => {
    expect(vehicleName(undefined)).toBeNull();
    expect(vehicleName(null)).toBeNull();
    expect(vehicleName('')).toBeNull();
    expect(vehicleName('hovercraft')).toBeNull();
  });
});
