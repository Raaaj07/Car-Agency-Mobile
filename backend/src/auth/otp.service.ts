import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.module';

const OTP_KEY_PREFIX = 'otp:phone:';
const OTP_ATTEMPTS_PREFIX = 'otp:attempts:';
const OTP_SEND_COUNT_PREFIX = 'otp:sendcount:';
const OTP_SEND_COOLDOWN_PREFIX = 'otp:sendcool:';
const OTP_FAIL_PREFIX = 'otp:fail:';
const MAX_VERIFY_ATTEMPTS = 5;
// SEC-1: per-phone failed-verify lockout. The per-code attempts counter is
// useless against an attacker who just re-sends (issue() resets it), so this
// counter lives on its own key, is never touched by issue(), and locks the
// number for the REST of its window once reached. Only a successful verify
// clears it.
const MAX_FAIL_PER_WINDOW = 10;
const FAIL_WINDOW_SECONDS = 3600;

@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;
  /**
   * Width of the codes this server issues (OTP_LENGTH, clamped to the 4..8
   * window VerifyOtpDto accepts so the code width and the DTO regex can never
   * disagree). Public: POST /auth/otp/send echoes it so the OTP screen renders
   * that many boxes (apps default to 4 when the field is absent).
   */
  readonly otpLength: number;
  private readonly sendMax: number;
  private readonly sendWindowSeconds: number;
  private readonly resendCooldownSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = this.config.get<number>('OTP_TTL_SECONDS') ?? 300;
    // Env vars are strings at runtime — convert once here instead of relying
    // on implicit coercion at every use site.
    const len = Math.trunc(Number(this.config.get<string>('OTP_LENGTH') ?? 4));
    this.otpLength = Number.isFinite(len) && len >= 4 ? Math.min(len, 8) : 4;
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

  private failKey(phone: string) {
    return `${OTP_FAIL_PREFIX}${phone}`;
  }

  /**
   * SEC-1: current failed-verify count for the phone (0 when never failed).
   * Read from its own key precisely so issue() cannot reset it.
   */
  private async failCount(phone: string): Promise<number> {
    const raw = await this.redis.get(this.failKey(phone));
    const n = Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  private lockout(): HttpException {
    return new HttpException(
      'Too many failed OTP attempts. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * SEC-1: every failed verify counts toward the phone's lockout window.
   * Reaching the cap turns THIS failure into a 429 for the rest of the window.
   */
  private async failVerify(phone: string, reason: string): Promise<{ ok: boolean; reason?: string }> {
    const fails = await this.recordFailure(phone);
    if (fails >= MAX_FAIL_PER_WINDOW) throw this.lockout();
    return { ok: false, reason };
  }

  private async recordFailure(phone: string): Promise<number> {
    const key = this.failKey(phone);
    const count = await this.redis.incr(key);
    // Same crash-safe window pattern as the send counter (see ensureWindow).
    await this.ensureWindow(key, count, FAIL_WINDOW_SECONDS);
    return count;
  }

  /**
   * AU-1: strict per-phone limits, checked before any SMS is issued.
   *  - SEC-1 lockout: a phone with too many failed verifies is refused first,
   *    so a locked-out attacker cannot spend more SMS at all.
   *  - resend cooldown (default 30 s between sends to one number)
   *  - max sends per window (default 3 per 10 min)
   * Throwing here keeps the counter from being consumed by rejected requests
   * in the cooldown case, and consumes it once the request is allowed so a
   * burst cannot exceed the window cap.
   */
  async assertCanSend(phone: string): Promise<void> {
    if ((await this.failCount(phone)) >= MAX_FAIL_PER_WINDOW) {
      throw this.lockout();
    }
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
    // SEC-1: once the phone is locked, NO comparison runs — the window must
    // actually cap guesses, not just label them. Only time or a prior
    // successful verify can have cleared the counter (issue() never does).
    if ((await this.failCount(phone)) >= MAX_FAIL_PER_WINDOW) {
      throw this.lockout();
    }

    const attempts = await this.redis.incr(this.attemptsKey(phone));
    await this.ensureWindow(this.attemptsKey(phone), attempts, this.ttlSeconds);
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      return this.failVerify(phone, 'Too many attempts, request a new OTP');
    }

    const stored = await this.redis.get(this.key(phone));
    if (!stored) {
      return this.failVerify(phone, 'OTP expired or not found, request a new one');
    }
    // AU-2: constant-time comparison — a plain !== leaks prefix matches via
    // response timing. Length mismatch is rejected without timingSafeEqual
    // (it throws on unequal lengths).
    const storedBuf = Buffer.from(stored, 'utf8');
    const codeBuf = Buffer.from(code, 'utf8');
    const matches =
      storedBuf.length === codeBuf.length && timingSafeEqual(storedBuf, codeBuf);
    if (!matches) {
      return this.failVerify(phone, 'Incorrect OTP');
    }

    // SEC-1: success is the ONLY thing that clears the lockout counter.
    await this.redis.del(this.key(phone));
    await this.redis.del(this.attemptsKey(phone));
    await this.redis.del(this.failKey(phone));
    return { ok: true };
  }
}
