import { etaByVehicle, etaText, fastestVehicleId } from './vehicleEta';

describe('etaByVehicle', () => {
  it('keeps the shortest ETA per vehicle type', () => {
    expect(
      etaByVehicle([
        { vehicleType: 'sedan', etaMinutes: 7 },
        { vehicleType: 'sedan', etaMinutes: 3 },
        { vehicleType: 'auto', etaMinutes: 5 },
      ]),
    ).toEqual({ sedan: 3, auto: 5 });
  });

  it('rounds and never shows less than 1 minute', () => {
    expect(etaByVehicle([{ vehicleType: 'mini', etaMinutes: 0.2 }])).toEqual({ mini: 1 });
    expect(etaByVehicle([{ vehicleType: 'mini', etaMinutes: 4.6 }])).toEqual({ mini: 5 });
  });

  it('ignores unusable entries and returns {} for no drivers', () => {
    expect(etaByVehicle([])).toEqual({});
    expect(
      etaByVehicle([
        { vehicleType: 'suv', etaMinutes: Number.NaN },
        { vehicleType: 'suv', etaMinutes: -2 },
      ]),
    ).toEqual({});
  });
});

describe('fastestVehicleId', () => {
  it('names the single quickest type when two or more types have drivers', () => {
    expect(fastestVehicleId({ auto: 5, sedan: 3, suv: 9 })).toBe('sedan');
  });

  it('gives no badge for one available type, a tie, or nothing', () => {
    expect(fastestVehicleId({ sedan: 3 })).toBeNull();
    expect(fastestVehicleId({ auto: 4, sedan: 4 })).toBeNull();
    expect(fastestVehicleId({})).toBeNull();
  });
});

describe('etaText', () => {
  it('describes each state in plain words', () => {
    expect(etaText('loading', {}, 'sedan')).toBe('Checking nearby drivers\u2026');
    expect(etaText('error', {}, 'sedan')).toBe('Arrival time unavailable');
    expect(etaText('ready', { sedan: 3 }, 'sedan')).toBe('3 min away');
    expect(etaText('ready', { sedan: 3 }, 'auto')).toBe('No drivers nearby right now');
  });
});
