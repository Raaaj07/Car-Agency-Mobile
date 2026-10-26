import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { RefreshSessionEntity } from '../entities/refresh-session.entity';
import { assertTokenClaims } from '../token-claims';

export interface JwtPayload {
  sub: string; // user id
  /** Old tokens carried the phone number; nothing reads it (pass-4: PII out
   *  of new tokens) and new tokens omit it — kept optional so old tokens
   *  still parse until they expire. */
  phone?: string;
  role: 'rider' | 'driver' | 'admin';
  /** Task 3: issuer claim added to all new tokens. Old tokens without it are
   *  accepted for a 30-day grace window (see validate()). */
  iss?: string;
  /** Task 3: audience claim added to all new tokens. */
  aud?: string | string[];
  /** Refresh-session id this token pair belongs to (absent on pre-session tokens). */
  sid?: string;
}

export interface AuthenticatedUser {
  userId: string;
  phone: string;
  role: 'rider' | 'driver' | 'admin';
  /** The device session this request's token belongs to, when the token carries one. */
  sessionId?: string;
}

/**
 * Task 3 / Phase-1.2: the iss/aud rule lives in ONE place now
 * (`auth/token-claims.ts`); HTTP, Socket.IO and the photo proxy share it.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(RefreshSessionEntity) private readonly sessions: Repository<RefreshSessionEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
      // Task 3: pin algorithm — passport-jwt passes these to jsonwebtoken's
      // verify() under the hood. 'none' is explicitly excluded.
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Task 3: verify iss and aud claims on new tokens (grace period for old
    // tokens is inside assertTokenClaims, shared with the socket handshake).
    assertTokenClaims(payload);

    // Source of truth is the database, not the token claims: deleted or
    // deactivated users are rejected even before the access token expires.
    // Real database errors propagate as 5xx — only a missing or inactive user
    // is a 401 (a swallowed DB error here would trigger refresh → logout).
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.isActive === false) {
      throw new UnauthorizedException('User no longer active');
    }
    // A token that names its session dies the moment that session is revoked
    // (logout / logout-everywhere / replay detection / account deletion).
    if (payload.sid) {
      const session = await this.sessions.findOne({
        where: { id: payload.sid },
        select: { id: true, revokedAt: true },
      });
      if (!session || session.revokedAt) {
        throw new UnauthorizedException('Session ended');
      }
    }
    return {
      userId: user.id,
      phone: user.phone ?? '',
      role: (user.role ?? 'rider') as AuthenticatedUser['role'],
      ...(payload.sid ? { sessionId: payload.sid } : {}),
    };
  }
}
