import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';

export interface JwtPayload {
  sub: string; // user id
  phone: string;
  role: 'rider' | 'driver' | 'admin';
}

export interface AuthenticatedUser {
  userId: string;
  phone: string;
  role: 'rider' | 'driver' | 'admin';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Source of truth is the database, not the token claims: deleted or
    // deactivated users are rejected even before the access token expires.
    // Real database errors propagate as 5xx — only a missing or inactive user
    // is a 401 (a swallowed DB error here would trigger refresh → logout).
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.isActive === false) {
      throw new UnauthorizedException('User no longer active');
    }
    return { userId: user.id, phone: user.phone ?? '', role: (user.role ?? 'rider') as AuthenticatedUser['role'] };
  }
}
