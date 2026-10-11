import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { OtpService } from './otp.service';

/**
 * AU-1 (per-phone send limits: cooldown + window cap), AU-2 (timing-safe OTP
 * comparison) and SEC-1 (failed-verify lockout that issue() cannot reset).
 */
describe('OtpService', () => {
  let service: OtpService;
  let redis: Record<string, jest.Mock>;
  // What the fake Redis actually holds, so multi-key flows (issue/verify/
  // lockout) behave like real INCR/GET/DEL instead of a single canned reply.
  let failCounters: Map<string, number>;
  let issuedCode: string | null;

  beforeEach(() => {
    failCounters = new Map();
    issuedCode = null;
    redis = {
      ttl: jest.fn().mockResolvedValue(-2), // key does not exist
      incr: jest.fn().mockImplementation(async (key: string) => {
        if (key.startsWith('otp:fail:') || key.startsWith('otp:ipfail:')) {
          const next = (failCounters.get(key) ?? 0) + 1;
          failCounters.set(key, next);
          return next;
        }
        return 1;
      }),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockImplementation(async (key: string) => {
        if (key.startsWith('otp:fail:') || key.startsWith('otp:ipfail:')) {
          const n = failCounters.get(key);
          return n === undefined ? null : String(n);
        }
        if (key.startsWith('otp:phone:')) return issuedCode;
        return null;
      }),
      del: jest.fn().mockImplementation(async (key: string) => {
        failCounters.delete(key); // only ever holds fail keys here
        return 1;
      }),
      // Models the atomic verify script (OTP_VERIFY_SCRIPT): GET + compare +
      // DEL-on-match inside ONE call — exactly one caller can redeem a code.
      eval: jest.fn(async (_script: string, _numKeys: number, key: string, arg: string) => {
        if (!issuedCode) return -1;
        if (issuedCode === arg) {
          issuedCode = null; // consumed by the script
          await redis.del(key);
          return 1;
        }
        return 0;
      }),
    };
    service = new OtpService(
      redis as unknown as Redis,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
  });

  const expect429 = async (promise: Promise<unknown>, fragment?: string) => {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    if (fragment) {
      expect((err as HttpException).message).toContain(fragment);
    }
  };

  describe('assertCanSend (AU-1)', () => {
    it('blocks a resend during the cooldown without consuming the window counter', async () => {
      redis.ttl.mockResolvedValue(25);

      await expect429(service.assertCanSend('9876543210'), '25s');
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('allows the first sends of a window and rejects the 4th (max 3)', async () => {
      redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValueOnce(4);

      await expect(service.assertCanSend('9876543210')).resolves.toBeUndefined();
      await expect(service.assertCanSend('9876543210')).resolves.toBeUndefined();
      await expect(service.assertCanSend('9876543210')).resolves.toBeUndefined();
      await expect429(service.assertCanSend('9876543210'), 'Too many OTP requests');

      // Window starts on the first send; cooldown set after each allowed send.
      expect(redis.expire).toHaveBeenCalledWith('otp:sendcount:9876543210', 600);
      expect(redis.set).toHaveBeenCalledWith('otp:sendcool:9876543210', '1', 'EX', 30);
    });

    it('repairs a send counter that lost its TTL (crash between INCR and EXPIRE)', async () => {
      // 1st ttl call = cooldown key (none); 2nd = the counter key, found with no expiry.
      redis.ttl.mockResolvedValueOnce(-2).mockResolvedValueOnce(-1);
      redis.incr.mockResolvedValueOnce(2); // not the first hit, so only the repair path can set the TTL

      await expect(service.assertCanSend('9876543210')).resolves.toBeUndefined();

      expect(redis.expire).toHaveBeenCalledWith('otp:sendcount:9876543210', 600);
    });
  });

  describe('verify (AU-2)', () => {
    it('accepts the correct code and consumes it', async () => {
      redis.incr.mockResolvedValue(1); // first attempt
      issuedCode = '1234';

      await expect(service.verify('9876543210', '1234')).resolves.toEqual({ ok: true });
      expect(redis.del).toHaveBeenCalledWith('otp:phone:9876543210');
      // SEC-1: success is the only thing that clears the lockout counter.
      expect(redis.del).toHaveBeenCalledWith('otp:fail:9876543210');
    });

    it('rejects a wrong code of the same length (timing-safe compare)', async () => {
      redis.incr.mockResolvedValue(1);
      issuedCode = '1234';

      await expect(service.verify('9876543210', '9999')).resolves.toEqual({
        ok: false,
        reason: 'Incorrect OTP',
      });
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rejects a wrong-length code without throwing', async () => {
      redis.incr.mockResolvedValue(1);
      issuedCode = '1234';

      await expect(service.verify('9876543210', '99')).resolves.toEqual({
        ok: false,
        reason: 'Incorrect OTP',
      });
    });

    it('stops after the attempt cap', async () => {
      redis.incr.mockResolvedValue(6);

      await expect(service.verify('9876543210', '1234')).resolves.toEqual({
        ok: false,
        reason: 'Too many attempts, request a new OTP',
      });
      // The stored code is never read once the cap is hit (the lockout check
      // legitimately reads otp:fail:* first, so assert per-key).
      expect(redis.get).not.toHaveBeenCalledWith('otp:phone:9876543210');
    });

    it('reports an expired/unknown OTP', async () => {
      redis.incr.mockResolvedValue(1);
      issuedCode = null;

      await expect(service.verify('9876543210', '1234')).resolves.toEqual({
        ok: false,
        reason: 'OTP expired or not found, request a new one',
      });
    });

    it('a code can be redeemed exactly ONCE, even by parallel requests', async () => {
      redis.incr.mockResolvedValue(1); // both callers see "first attempt"
      issuedCode = '1234';

      const results = await Promise.all([
        service.verify('9876543210', '1234'),
        service.verify('9876543210', '1234'),
      ]);

      const successes = results.filter((r) => r.ok);
      const failures = results.filter((r) => !r.ok);
      expect(successes).toHaveLength(1);
      // The loser redeemed nothing: the atomic consume already took the code.
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toBe('OTP expired or not found, request a new one');
    });
  });

  describe('per-IP failed-verify cap (pass-4)', () => {
    it('triggers at the 21st failure across DIFFERENT phones', async () => {
      // Per-code attempts stay at 1; fail/ipfail keys count up in the shared
      // counter store (a plain mockResolvedValue would clobber that logic).
      redis.incr.mockImplementation(async (key: string) => {
        if (key.startsWith('otp:attempts:')) return 1;
        const next = (failCounters.get(key) ?? 0) + 1;
        failCounters.set(key, next);
        return next;
      });
      // 20 wrong guesses spread over 20 victim numbers — each phone is far
      // below its own lockout, so only the IP cap can stop the campaign.
      for (let i = 0; i < 20; i++) {
        issuedCode = '1234';
        const phone = `900000${String(i).padStart(4, '0')}`;
        await expect(service.verify(phone, '9999', '203.0.113.7')).resolves.toEqual({
          ok: false,
          reason: 'Incorrect OTP',
        });
      }
      // The 21st guess from the same IP is refused outright (no comparison).
      const err = await service
        .verify('9000009999', '9999', '203.0.113.7')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('a capped IP cannot verify even with the CORRECT code; another IP can', async () => {
      failCounters.set('otp:ipfail:203.0.113.7', 20);
      redis.incr.mockResolvedValue(1);
      issuedCode = '1234';

      // The capped IP is refused before any comparison runs...
      await expect429(service.verify('9876543210', '1234', '203.0.113.7'));
      // ...and the code is untouched, so another IP redeems it normally.
      await expect(service.verify('9876543210', '1234', '198.51.100.9')).resolves.toEqual({
        ok: true,
      });
    });

    it('verify without an IP stays backwards compatible (no IP counter)', async () => {
      redis.incr.mockResolvedValue(1);
      issuedCode = '1234';

      await expect(service.verify('9876543210', '1234')).resolves.toEqual({ ok: true });
      expect(failCounters.has('otp:ipfail:undefined')).toBe(false);
    });
  });

  describe('failed-verify lockout (SEC-1)', () => {
    const failKey = 'otp:fail:9876543210';

    it('locks on the 10th failure and stops comparing codes entirely', async () => {
      issuedCode = '1234';
      for (let i = 0; i < 9; i++) {
        await expect(service.verify('9876543210', '9999')).resolves.toEqual({
          ok: false,
          reason: 'Incorrect OTP',
        });
      }
      // The failure that reaches the cap is already a 429...
      await expect429(service.verify('9876543210', '9999'));
      // ...and even the CORRECT code no longer runs a comparison while locked.
      await expect429(service.verify('9876543210', '1234'));
      expect(failCounters.get(failKey)).toBe(10);
    });

    it('refuses to send new codes while locked, without spending budget', async () => {
      failCounters.set(failKey, 10);

      // Generic message: the caller cannot tell failure-lock from send-lock.
      await expect429(service.assertCanSend('9876543210'), 'Too many attempts');
      expect(redis.incr).not.toHaveBeenCalled(); // window counter untouched
      expect(redis.set).not.toHaveBeenCalled(); // no cooldown consumed
    });

    it('is NOT reset by issue() — a re-send cannot buy fresh guesses', async () => {
      failCounters.set(failKey, 10);

      await service.issue('9876543210'); // issues a fresh code + resets attempts
      expect(failCounters.get(failKey)).toBe(10); // lock survives the re-issue
      await expect429(service.verify('9876543210', '1234'));
    });

    it('a successful verify clears the lockout and restarts the count', async () => {
      failCounters.set(failKey, 9);
      issuedCode = '1234';

      await expect(service.verify('9876543210', '1234')).resolves.toEqual({ ok: true });
      expect(failCounters.has(failKey)).toBe(false); // deleted on success

      // The next failure starts a fresh count at 1 — not an instant re-lock.
      // (The successful verify consumed the stored code, so a fresh one is
      // needed for a WRONG guess to reach the comparison at all.)
      issuedCode = '1234';
      await expect(service.verify('9876543210', '9999')).resolves.toEqual({
        ok: false,
        reason: 'Incorrect OTP',
      });
      expect(failCounters.get(failKey)).toBe(1);
    });
  });
});
