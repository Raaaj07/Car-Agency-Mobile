import { canSendLastKnown, LAST_KNOWN_MAX_AGE_MS, withTimeout } from './heartbeat';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('fix'), 4_000)).resolves.toBe('fix');
  });

  it('passes a rejection through unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('gps off')), 4_000)).rejects.toThrow('gps off');
  });

  it('rejects with "timeout" when the promise never settles (no GPS fix)', async () => {
    const pending = new Promise<string>(() => {});
    const result = withTimeout(pending, 4_000);
    const assertion = expect(result).rejects.toThrow('timeout');
    jest.advanceTimersByTime(4_000);
    await assertion;
  });

  it('does not reject later once the promise already settled', async () => {
    const result = withTimeout(Promise.resolve(1), 4_000);
    await expect(result).resolves.toBe(1);
    jest.advanceTimersByTime(10_000); // the cleared timer must not fire
    await expect(result).resolves.toBe(1);
  });
});

describe('canSendLastKnown', () => {
  const now = 1_000_000_000_000;

  it('re-sends a position that was a real fix within the last 30 minutes', () => {
    expect(canSendLastKnown(now - 5_000, now)).toBe(true);
    expect(canSendLastKnown(now - 20 * 60_000, now)).toBe(true);
    expect(canSendLastKnown(now - LAST_KNOWN_MAX_AGE_MS, now)).toBe(true);
  });

  it('stops once the last fix is too old to trust', () => {
    expect(canSendLastKnown(now - LAST_KNOWN_MAX_AGE_MS - 1, now)).toBe(false);
    expect(canSendLastKnown(now - 3 * 60 * 60_000, now)).toBe(false);
  });

  it('never re-sends when there was no real fix yet', () => {
    expect(canSendLastKnown(0, now)).toBe(false);
    expect(canSendLastKnown(Number.NaN, now)).toBe(false);
  });
});
