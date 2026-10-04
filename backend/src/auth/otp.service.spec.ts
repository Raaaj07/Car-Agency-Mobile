import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { OtpService } from './otp.service';

/**
 * AU-1 (per-phone send limits: cooldown + window cap) and
 * AU-2 (timing-safe OTP comparison).
 */
describe('OtpService', () => {
  let service: OtpService;
  let redis: Record<string, jest.Mock>;

  beforeEach(() => {
    redis = {
      ttl: jest.fn().mockResolvedValue(-2), // key does not exist
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
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
  });

  describe('verify (AU-2)', () => {
    it('accepts the correct code and consumes it', async () => {
      redis.incr.mockResolvedValue(1); // first attempt
      redis.get.mockResolvedValue('1234');

      await expect(service.verify('9876543210', '1234')).resolves.toEqual({ ok: true });
      expect(redis.del).toHaveBeenCalledWith('otp:phone:9876543210');
    });

    it('rejects a wrong code of the same length (timing-safe compare)', async () => {
      redis.incr.mockResolvedValue(1);
      redis.get.mockResolvedValue('1234');

      await expect(service.verify('9876543210', '9999')).resolves.toEqual({
        ok: false,
        reason: 'Incorrect OTP',
      });
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rejects a wrong-length code without throwing', async () => {
      redis.incr.mockResolvedValue(1);
      redis.get.mockResolvedValue('1234');

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
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('reports an expired/unknown OTP', async () => {
      redis.incr.mockResolvedValue(1);
      redis.get.mockResolvedValue(null);

      await expect(service.verify('9876543210', '1234')).resolves.toEqual({
        ok: false,
        reason: 'OTP expired or not found, request a new one',
      });
    });
  });
});
