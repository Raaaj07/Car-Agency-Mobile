import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * SEC-5: the stock ThrottlerGuard keys every bucket on req.ip. That fails in
 * both directions mobile traffic actually moves:
 *  - thousands of users sit behind ONE address (CGNAT, the platform proxy
 *    with TRUST_PROXY=true), so one noisy client starves the shared 300/min
 *    budget and unrelated users get 429s that are not their fault;
 *  - an attacker rotates source IPs to mint a fresh bucket per request.
 *
 * So AUTHENTICATED traffic is keyed per USER (the JWT subject) and anonymous
 * traffic keeps the (TRUST_PROXY-aware) IP key. The OTP send/verify, social
 * sign-in and photo-stream routes are anonymous → they keep the per-IP
 * backstop that complements OtpService's per-phone limits.
 *
 * The subject is VERIFIED, never just decoded: an unverified `sub` would let
 * an attacker forge a fresh identity per request and defeat the point.
 * Expired / forged / garbage tokens fall back to the IP bucket — a bad token
 * never mints a new bucket.
 */
@Injectable()
export class UserKeyedThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as { authorization?: unknown } | undefined;
    const header = headers?.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync(token);
        const sub = (payload as { sub?: unknown }).sub;
        if (typeof sub === 'string' && sub.length > 0) {
          return `user:${sub}`;
        }
      } catch {
        // Expired / foreign-issuer / tampered: fall through to the IP bucket.
      }
    }
    const ip = req.ip;
    return `ip:${typeof ip === 'string' && ip ? ip : 'unknown'}`;
  }
}
