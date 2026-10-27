import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { UserEntity } from './entities/user.entity';
import { JwtPayload } from './strategies/jwt.strategy';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

// Task 3: Grace period (30 days from first deploy) in which tokens without
// `iss`/`aud` are still accepted. After that constant is removed the fallback
// in JwtStrategy should also be removed.
export const JWT_ISS = 'vazhi-api';
export const JWT_AUD = 'vazhi-app';

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `sessionId` (the refresh_sessions row id) rides in both tokens as `sid`, so
   * logout can end exactly this device's session and a revoked session stops
   * working immediately instead of when the access token expires.
   */
  issueTokens(user: UserEntity, sessionId?: string): TokenPair {
    // Pass-4 (task 3): `phone` is no longer put into NEW tokens — a bearer
    // token ends up in logs, proxies, crash reports and the clipboard, and
    // nothing reads the claim (JwtStrategy and the socket gateway both load
    // the user row instead). JwtPayload.phone stays optional so OLD tokens
    // that still carry it keep parsing until they expire (<= 30 d).
    // Task 3: pin algorithm to HS256 and add iss/aud claims to every new token.
    const payload: JwtPayload = {
      sub: user.id,
      role: (user.role ?? 'rider') as 'rider' | 'driver' | 'admin',
      iss: JWT_ISS,
      aud: JWT_AUD,
      ...(sessionId ? { sid: sessionId } : {}),
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as JwtSignOptions['expiresIn'],
      algorithm: 'HS256',
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d') as JwtSignOptions['expiresIn'],
      algorithm: 'HS256',
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    };
  }
}
