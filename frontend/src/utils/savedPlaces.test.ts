import { conflictingLabel, labelName, placeKey, savedForLabel } from './savedPlaces';

const home = { id: 'h1', label: 'home', lat: 11.3410, lng: 77.7172 };
const work = { id: 'w1', label: 'work', lat: 11.6643, lng: 78.1460 };
const heart = { id: 's1', label: null, lat: 11.5, lng: 77.9 };

describe('labelName', () => {
  it('names the two shortcuts', () => {
    expect(labelName('home')).toBe('Home');
    expect(labelName('work')).toBe('Work');
  });
});

describe('placeKey', () => {
  it('rounds to 4 decimals like the backend, so nearby points are the same place', () => {
    expect(placeKey({ lat: 11.34104, lng: 77.71724 })).toBe('11.3410,77.7172');
    expect(placeKey({ lat: 11.34102, lng: 77.71718 })).toBe(placeKey({ lat: 11.34104, lng: 77.71724 }));
  });

  it('tells apart places more than about 11 m apart', () => {
    expect(placeKey({ lat: 11.3410, lng: 77.7172 })).not.toBe(placeKey({ lat: 11.3412, lng: 77.7172 }));
  });
});

describe('savedForLabel', () => {
  it('finds the Home and the Work entry', () => {
    const saved = [heart, home, work];
    expect(savedForLabel(saved, 'home')).toBe(home);
    expect(savedForLabel(saved, 'work')).toBe(work);
  });

  it('is undefined when nothing carries the label (a plain hearted place is not Home or Work)', () => {
    expect(savedForLabel([heart], 'home')).toBeUndefined();
    expect(savedForLabel([], 'work')).toBeUndefined();
  });
});

describe('conflictingLabel', () => {
  it('flags a place that is already the OTHER shortcut', () => {
    // Setting Work to the place that is Home would take Home away.
    expect(conflictingLabel([home, work], 'work', { lat: 11.34102, lng: 77.71718 })).toBe('home');
    expect(conflictingLabel([home, work], 'home', { lat: 11.6643, lng: 78.146 })).toBe('work');
    // Only Home exists, and the place being saved as Work is Home's place.
    expect(conflictingLabel([home], 'work', { lat: 11.3410, lng: 77.7172 })).toBe('home');
  });

  it('allows a different place, the shortcut\u2019s own place, and a missing other shortcut', () => {
    expect(conflictingLabel([home, work], 'work', { lat: 12.0, lng: 78.0 })).toBeNull();
    // Re-saving Home at the same spot is fine: the other label is Work, which is elsewhere.
    expect(conflictingLabel([home, work], 'home', { lat: 11.3410, lng: 77.7172 })).toBeNull();
    // No Home saved at all, so nothing can be taken away.
    expect(conflictingLabel([work], 'work', { lat: 11.3410, lng: 77.7172 })).toBeNull();
    expect(conflictingLabel([], 'work', { lat: 11.3410, lng: 77.7172 })).toBeNull();
  });
});
