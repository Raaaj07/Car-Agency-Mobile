/// <reference types="jest" />
import { UnauthorizedException } from '@nestjs/common';
import { assertTokenClaims, CLAIMS_GRACE_DEADLINE } from './token-claims';
import { JWT_AUD, JWT_ISS } from './tokens.service';

/**
 * Phase-1.2: ONE claims rule for HTTP, sockets and the photo proxy. The
 * grace window (tokens without iss/aud accepted) must keep working exactly
 * until the deadline, and be gone after it.
 */
describe('assertTokenClaims', () => {
  const beforeDeadline = new Date(CLAIMS_GRACE_DEADLINE.getTime() - 1_000);
  const afterDeadline = new Date(CLAIMS_GRACE_DEADLINE.getTime() + 1_000);

  it('accepts a token carrying the correct iss/aud', () => {
    expect(() =>
      assertTokenClaims({ iss: JWT_ISS, aud: JWT_AUD }, afterDeadline),
    ).not.toThrow();
  });

  it('accepts an array audience that contains the app', () => {
    expect(() =>
      assertTokenClaims({ iss: JWT_ISS, aud: ['other-app', JWT_AUD] }, afterDeadline),
    ).not.toThrow();
  });

  it('accepts a legacy token without claims DURING the grace window', () => {
    expect(() => assertTokenClaims({}, beforeDeadline)).not.toThrow();
  });

  it('rejects a token without claims AFTER the deadline', () => {
    expect(() => assertTokenClaims({}, afterDeadline)).toThrow(UnauthorizedException);
  });

  it('rejects a legacy token that carries only one of the two claims after the deadline', () => {
    expect(() => assertTokenClaims({ iss: JWT_ISS }, afterDeadline)).toThrow(
      UnauthorizedException,
    );
    expect(() => assertTokenClaims({ aud: JWT_AUD }, afterDeadline)).toThrow(
      UnauthorizedException,
    );
  });

  it('always rejects a wrong issuer, even during the grace window', () => {
    expect(() =>
      assertTokenClaims({ iss: 'evil-api', aud: JWT_AUD }, beforeDeadline),
    ).toThrow(UnauthorizedException);
  });

  it('always rejects a wrong audience, even during the grace window', () => {
    expect(() =>
      assertTokenClaims({ iss: JWT_ISS, aud: 'another-app' }, beforeDeadline),
    ).toThrow(UnauthorizedException);
  });
});
