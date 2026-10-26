import { UnauthorizedException } from '@nestjs/common';
import { JWT_AUD, JWT_ISS } from './tokens.service';

/**
 * Task 3 grace-period deadline: 30 days after first deploy of this build.
 * Set to an explicit past date to stop accepting old tokens (remove the
 * grace branch in `assertTokenClaims` at that point too).
 *
 * 2026-11-18T00:00:00Z = 30 days after 2026-10-19 deploy.
 */
export const CLAIMS_GRACE_DEADLINE = new Date('2026-11-18T00:00:00Z');

/** The subset of an access token this check needs (works for JWTs from any signer). */
export interface TokenClaims {
  iss?: string;
  aud?: string | string[];
}

/**
 * Task 3 / Phase-1.2: ONE implementation of the iss/aud rule, shared by the
 * HTTP JwtStrategy, the Socket.IO handshake and the optional photo-proxy auth.
 * Duplicating it let the three entry points drift apart.
 *
 * Behaviour is unchanged: a wrong iss/aud is always rejected; a token that
 * omits both is accepted only while the grace window is open.
 */
// TODO(2026-11-18): delete the grace branch (and CLAIMS_GRACE_DEADLINE) once
// every access token in circulation carries iss/aud.
export function assertTokenClaims(payload: TokenClaims, now: Date = new Date()): void {
  const gracePeriodActive = now < CLAIMS_GRACE_DEADLINE;
  const hasIss = !!payload.iss;
  const hasAud = !!payload.aud;

  if (hasIss && payload.iss !== JWT_ISS) {
    throw new UnauthorizedException('Invalid token issuer');
  }
  if (hasAud) {
    const audArr = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audArr.includes(JWT_AUD)) {
      throw new UnauthorizedException('Invalid token audience');
    }
  }
  // After the grace period, require the claims on every token.
  if (!gracePeriodActive && (!hasIss || !hasAud)) {
    throw new UnauthorizedException('Token missing required claims');
  }
}
