/// <reference types="jest" />
import { BoundedMap } from './bounded-map';

describe('BoundedMap', () => {
  it('evicts the oldest entry once the cap is exceeded', () => {
    const m = new BoundedMap<string, number>(3);
    m.set('a', 1).set('b', 2).set('c', 3).set('d', 4);
    expect(m.size).toBe(3);
    expect(m.has('a')).toBe(false);
    expect([...m.keys()]).toEqual(['b', 'c', 'd']);
  });

  it('re-setting a key refreshes it, so it is evicted last', () => {
    const m = new BoundedMap<string, number>(3);
    m.set('a', 1).set('b', 2).set('c', 3);
    m.set('a', 10); // a is now the newest
    m.set('d', 4); // evicts b, not a
    expect([...m.keys()]).toEqual(['c', 'a', 'd']);
    expect(m.get('a')).toBe(10);
  });

  it('never grows past the cap under many distinct keys', () => {
    const m = new BoundedMap<number, number>(50);
    for (let i = 0; i < 10_000; i++) m.set(i, i);
    expect(m.size).toBe(50);
  });
});
