import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.module';

const OTP_KEY_PREFIX = 'otp:phone:';
const OTP_ATTEMPTS_PREFIX = 'otp:attempts:';
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;
  private readonly otpLength: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = this.config.get<number>('OTP_TTL_SECONDS') ?? 300;
    this.otpLength = this.config.get<number>('OTP_LENGTH') ?? 4;
  }

  private key(phone: string) {
    return `${OTP_KEY_PREFIX}${phone}`;
  }

  private attemptsKey(phone: string) {
    return `${OTP_ATTEMPTS_PREFIX}${phone}`;
  }

  generateCode(): string {
    const max = 10 ** this.otpLength;
    const code = Math.floor(Math.random() * max)
      .toString()
      .padStart(this.otpLength, '0');
    return code;
  }

  async issue(phone: string): Promise<string> {
    const code = this.generateCode();
    await this.redis.set(this.key(phone), code, 'EX', this.ttlSeconds);
    await this.redis.del(this.attemptsKey(phone));
    return code;
  }

  async verify(phone: string, code: string): Promise<{ ok: boolean; reason?: string }> {
    const attempts = await this.redis.incr(this.attemptsKey(phone));
    if (attempts === 1) {
      await this.redis.expire(this.attemptsKey(phone), this.ttlSeconds);
    }
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      return { ok: false, reason: 'Too many attempts, request a new OTP' };
    }

    const stored = await this.redis.get(this.key(phone));
    if (!stored) {
      return { ok: false, reason: 'OTP expired or not found, request a new one' };
    }
    if (stored !== code) {
      return { ok: false, reason: 'Incorrect OTP' };
    }

    await this.redis.del(this.key(phone));
    await this.redis.del(this.attemptsKey(phone));
    return { ok: true };
  }
}
