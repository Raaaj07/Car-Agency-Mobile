/// <reference types="jest" />
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { UserKeyedThrottlerGuard } from './user-keyed-throttler.guard';

/**
 * SEC-5: the tracker decides which bucket a request burns — the VERIFIED JWT
 * subject for authenticated traffic, the IP otherwise. A forged or expired
 * token must fall back to the IP bucket, never mint a fresh per-user one.
 */
describe('UserKeyedThrottlerGuard', () => {
  type TrackerApi = { getTracker(req: Record<string, unknown>): Promise<string> };

  const build = (verifyAsync: jest.Mock): TrackerApi => {
    const guard = new UserKeyedThrottlerGuard(
      [{ ttl: 60_000, limit: 300 }],
      { increment: jest.fn(), decrement: jest.fn() } as unknown as ThrottlerStorage,
      new Reflector(),
      { verifyAsync } as unknown as JwtService,
    );
    return guard as unknown as TrackerApi;
  };

  it('keys an authenticated request on the VERIFIED JWT subject', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({ sub: 'user-42' });
    const tracker = await build(verifyAsync).getTracker({
      headers: { authorization: 'Bearer signed.token.here' },
      ip: '203.0.113.9',
    });

    expect(tracker).toBe('user:user-42');
    // The raw token is verified — never just decoded.
    expect(verifyAsync).toHaveBeenCalledWith('signed.token.here');
  });

  it('falls back to the IP bucket for an expired/forged token', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('jwt expired'));
    const tracker = await build(verifyAsync).getTracker({
      headers: { authorization: 'Bearer forged.token.value' },
      ip: '203.0.113.9',
    });

    expect(tracker).toBe('ip:203.0.113.9');
  });

  it('falls back to the IP bucket when the payload has no subject', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({ scope: 'weird' });
    const tracker = await build(verifyAsync).getTracker({
      headers: { authorization: 'Bearer no.subject.here' },
      ip: '198.51.100.7',
    });

    expect(tracker).toBe('ip:198.51.100.7');
  });

  it('anonymous requests key on req.ip (the TRUST_PROXY-aware address)', async () => {
    const verifyAsync = jest.fn();
    const tracker = await build(verifyAsync).getTracker({ ip: '192.0.2.15' });

    expect(tracker).toBe('ip:192.0.2.15');
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('survives a context without headers or ip (WS-style clients)', async () => {
    const tracker = await build(jest.fn()).getTracker({});

    expect(tracker).toBe('ip:unknown');
  });
});
