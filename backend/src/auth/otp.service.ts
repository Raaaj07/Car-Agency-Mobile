import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.module';

const OTP_KEY_PREFIX = 'otp:phone:';
const OTP_ATTEMPTS_PREFIX = 'otp:attempts:';
const OTP_SEND_COUNT_PREFIX = 'otp:sendcount:';
const OTP_SEND_COOLDOWN_PREFIX = 'otp:sendcool:';
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;
  private readonly otpLength: number;
  private readonly sendMax: number;
  private readonly sendWindowSeconds: number;
  private readonly resendCooldownSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = this.config.get<number>('OTP_TTL_SECONDS') ?? 300;
    this.otpLength = this.config.get<number>('OTP_LENGTH') ?? 4;
    // AU-1: per-phone SMS bomb guard (defaults are intentionally strict).
    this.sendMax = this.config.get<number>('OTP_SEND_MAX') ?? 3;
    this.sendWindowSeconds = this.config.get<number>('OTP_SEND_WINDOW_SECONDS') ?? 600;
    this.resendCooldownSeconds = this.config.get<number>('OTP_RESEND_COOLDOWN_SECONDS') ?? 30;
  }

  private key(phone: string) {
    return `${OTP_KEY_PREFIX}${phone}`;
  }

  private attemptsKey(phone: string) {
    return `${OTP_ATTEMPTS_PREFIX}${phone}`;
  }

  private sendCountKey(phone: string) {
    return `${OTP_SEND_COUNT_PREFIX}${phone}`;
  }

  private sendCooldownKey(phone: string) {
    return `${OTP_SEND_COOLDOWN_PREFIX}${phone}`;
  }

  /**
   * AU-1: strict per-phone limits, checked before any SMS is issued.
   *  - resend cooldown (default 30 s between sends to one number)
   *  - max sends per window (default 3 per 10 min)
   * Throwing here keeps the counter from being consumed by rejected requests
   * in the cooldown case, and consumes it once the request is allowed so a
   * burst cannot exceed the window cap.
   */
  async assertCanSend(phone: string): Promise<void> {
    const cooldownTtl = await this.redis.ttl(this.sendCooldownKey(phone));
    if (cooldownTtl > 0) {
      throw new HttpException(
        `Please wait ${cooldownTtl}s before requesting another OTP`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const count = await this.redis.incr(this.sendCountKey(phone));
    await this.ensureWindow(this.sendCountKey(phone), count, this.sendWindowSeconds);
    if (count > this.sendMax) {
      throw new HttpException(
        `Too many OTP requests. Try again in ${Math.ceil(this.sendWindowSeconds / 60)} minutes`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.redis.set(this.sendCooldownKey(phone), '1', 'EX', this.resendCooldownSeconds);
  }

  /**
   * INCR and EXPIRE are two separate Redis commands. If the process died
   * between them the counter was left WITHOUT a TTL and never reset — a phone
   * number could stay locked out of OTP login permanently. So the window is
   * applied on the first hit AND repaired whenever a counter is found with no
   * expiry (TTL -1).
   */
  private async ensureWindow(key: string, count: number, seconds: number): Promise<void> {
    if (count === 1 || (await this.redis.ttl(key)) === -1) {
      await this.redis.expire(key, seconds);
    }
  }

  generateCode(): string {
    // crypto-secure: Math.random is predictable, never use for OTPs.
    const max = 10 ** this.otpLength;
    return randomInt(0, max).toString().padStart(this.otpLength, '0');
  }

  async issue(phone: string): Promise<string> {
    const code = this.generateCode();
    await this.redis.set(this.key(phone), code, 'EX', this.ttlSeconds);
    await this.redis.del(this.attemptsKey(phone));
    return code;
  }

  async verify(phone: string, code: string): Promise<{ ok: boolean; reason?: string }> {
    const attempts = await this.redis.incr(this.attemptsKey(phone));
    await this.ensureWindow(this.attemptsKey(phone), attempts, this.ttlSeconds);
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      return { ok: false, reason: 'Too many attempts, request a new OTP' };
    }

    const stored = await this.redis.get(this.key(phone));
    if (!stored) {
      return { ok: false, reason: 'OTP expired or not found, request a new one' };
    }
    // AU-2: constant-time comparison — a plain !== leaks prefix matches via
    // response timing. Length mismatch is rejected without timingSafeEqual
    // (it throws on unequal lengths).
    const storedBuf = Buffer.from(stored, 'utf8');
    const codeBuf = Buffer.from(code, 'utf8');
    const matches =
      storedBuf.length === codeBuf.length && timingSafeEqual(storedBuf, codeBuf);
    if (!matches) {
      return { ok: false, reason: 'Incorrect OTP' };
    }

    await this.redis.del(this.key(phone));
    await this.redis.del(this.attemptsKey(phone));
    return { ok: true };
  }
}
