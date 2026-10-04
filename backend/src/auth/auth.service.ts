import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { User as FrontendUser } from '../common/frontend-contracts';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { UserEntity } from './entities/user.entity';
import { OtpService } from './otp.service';
import { SMS_PROVIDER, SmsProvider } from './providers/sms-provider.interface';
import { TokenPair, TokensService } from './tokens.service';
import { StorageService } from '../drivers/storage.service';
import { toAvatarUrl } from '../common/avatar-url';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { UpdateMeDto } from './dto/update-me.dto';

export interface VerifyOtpResult extends TokenPair {
  user: FrontendUser;
  isNewUser: boolean;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

type DriverStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';

function mapStatusToDriverStatus(v: string | null | undefined): DriverStatus {
  if (v === 'approved' || v === 'pending' || v === 'rejected' || v === 'suspended') return v;
  return 'none';
}

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
  ) {}

  // Matches MobileNumberScreen -> POST /auth/otp/send
  async sendOtp({ phone }: SendOtpDto): Promise<{ message: string; expiresInSeconds: number; devOtp?: string }> {
    const code = await this.otp.issue(phone);
    await this.sms.sendOtp(phone, code);
    const ttl = Number(this.config.get<string>('OTP_TTL_SECONDS') ?? 300);
    const response = { message: 'OTP sent', expiresInSeconds: Number.isFinite(ttl) ? ttl : 300 };

    // Fail-closed default: missing env means no leak. Prod refusal enforced in Phase 6.
    const isProd = (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';
    const devModeFlag = (this.config.get<string>('OTP_DEV_MODE') ?? 'false') === 'true';
    if (devModeFlag && !isProd) {
      return { ...response, devOtp: code };
    }
    return response;
  }

  // Single login for everyone: new users are riders with profileComplete=false.
  async verifyOtp({ phone, otp, name }: VerifyOtpDto): Promise<VerifyOtpResult> {
    const result = await this.otp.verify(phone, otp);
    if (!result.ok) {
      throw new BadRequestException(result.reason ?? 'Invalid OTP');
    }

    let user = await this.users.findOne({ where: { phone } });
    const isNewUser = !user;

    if (!user) {
      user = this.users.create({
        phone,
        name: name?.trim() || 'New Rider',
        role: 'rider',
        language: 'en',
        profileComplete: false,
      });
    } else if (!user.role) {
      user.role = 'rider';
    }
    user = await this.users.save(user);
    // First admin(s) can also be promoted at OTP login (covers phones that
    // signed up after the last server start; ADMIN_PHONES is 10-digit).
    await this.promoteAdminByPhone(user);

    const tokenPair = await this.issueAndPersist(user);
    const full = await this.toFullUser(user);
    return { ...tokenPair, user: full, isNewUser };
  }

  // Shared with AdminService.onApplicationBootstrap (start-up promotion).
  // Compares trailing-10-digit phone forms so "+91..." entries still match.
  private async promoteAdminByPhone(user: UserEntity): Promise<void> {
    if ((user.role as string) === 'admin') return;
    const raw = this.config.get<string>('ADMIN_PHONES') ?? '';
    const want = new Set(
      raw.split(',').map((s) => s.replace(/\D/g, '').slice(-10)).filter((s) => s.length === 10),
    );
    const mine = (user.phone ?? '').replace(/\D/g, '').slice(-10);
    if (want.size > 0 && mine.length === 10 && want.has(mine)) {
      await this.users.update({ id: user.id }, { role: 'admin' as any }).catch(() => {});
      user.role = 'admin' as any;
    }
  }

  async googleSignIn(idToken: string): Promise<VerifyOtpResult> {
    const audience = this.config.get<string>('GOOGLE_WEB_CLIENT_ID');
    const ticket = await this.googleClient.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new BadRequestException('Invalid Google token');

    let user = await this.users.findOne({ where: { googleId: payload.sub } });
    let isNewUser = !user;
    if (!user && payload.email) {
      // Prevent account takeover: only link when Google confirms the email.
      if (payload.email_verified !== true) {
        throw new BadRequestException('Google email not verified');
      }
      user = await this.users.findOne({ where: { email: payload.email } });
    }
    if (!user) {
      user = this.users.create({
        googleId: payload.sub,
        email: payload.email ?? null,
        name: payload.name || 'New Rider',
        avatar: payload.picture ?? null,
        role: 'rider',
        language: 'en',
        profileComplete: false,
      });
      isNewUser = true;
    } else {
      if (!user.googleId) user.googleId = payload.sub;
      if (!user.role) user.role = 'rider';
      if (payload.picture && !user.avatar) user.avatar = payload.picture;
    }
    user = await this.users.save(user);

    const tokenPair = await this.issueAndPersist(user);
    const full = await this.toFullUser(user);
    return { ...tokenPair, user: full, isNewUser };
  }

  async appleSignIn(identityToken: string, fullName: string | undefined): Promise<VerifyOtpResult> {
    const payload = await appleSignin.verifyIdToken(identityToken, {
      audience: this.config.get<string>('APPLE_CLIENT_ID'),
    });
    if (!payload?.sub) throw new BadRequestException('Invalid Apple token');

    let user = await this.users.findOne({ where: { appleId: payload.sub } });
    let isNewUser = !user;
    if (!user) {
      user = this.users.create({
        appleId: payload.sub,
        email: (payload as any).email ?? null,
        // Apple only sends fullName on the FIRST sign-in ever — capture it now or lose it.
        name: fullName?.trim() || 'New Rider',
        role: 'rider',
        language: 'en',
        profileComplete: false,
      });
      isNewUser = true;
    }
    if (!user.role) user.role = 'rider';
    user = await this.users.save(user);

    const tokenPair = await this.issueAndPersist(user);
    const full = await this.toFullUser(user);
    return { ...tokenPair, user: full, isNewUser };
  }

  async findById(userId: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id: userId } });
  }

  async me(userId: string): Promise<FrontendUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return this.toFullUser(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<FrontendUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) throw new BadRequestException('Name cannot be empty');
      user.name = trimmed;
      // Name is the only required profile field: a real name completes onboarding.
      if (trimmed.length >= 2 && !/^new\s/i.test(trimmed)) {
        user.profileComplete = true;
      }
    }
    if (dto.email !== undefined) user.email = dto.email?.toLowerCase().trim() || null;

    try {
      const saved = await this.users.save(user);
      return this.toFullUser(saved);
    } catch (err: any) {
      if (err?.code === '23505') throw new BadRequestException('Email already in use');
      throw err;
    }
  }

  // Rotating refresh: each use issues a new pair and replaces the stored hash.
  async refresh(refreshToken: string): Promise<TokenPair> {
    let sub: string;
    try {
      const decoded = (await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      })) as { sub: string };
      sub = decoded.sub;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.users.findOne({ where: { id: sub } });
    if (!user || user.isActive === false) throw new UnauthorizedException('User no longer active');
    if (!user.refreshTokenHash || user.refreshTokenHash !== hashToken(refreshToken)) {
      throw new UnauthorizedException('Refresh token revoked');
    }
    return this.issueAndPersist(user);
  }

  async logout(userId: string): Promise<{ ok: true }> {
    await this.users.update({ id: userId }, { refreshTokenHash: null });
    return { ok: true };
  }

  private async issueAndPersist(user: UserEntity): Promise<TokenPair> {
    const pair = this.tokens.issueTokens(user);
    await this.users.update({ id: user.id }, { refreshTokenHash: hashToken(pair.refreshToken) });
    return pair;
  }

  private async toFullUser(user: UserEntity): Promise<FrontendUser> {
    const base = user.toFrontendUser();
    const driver = await this.drivers.findOne({ where: { userId: user.id } }).catch(() => null);
    // `status` is the only source of truth; `verificationStatus` is deprecated.
    const driverStatus: DriverStatus = driver ? mapStatusToDriverStatus((driver as any).status) : 'none';
    return { ...base, avatar: this.avatarUrl(user), driverStatus };
  }

  // Local uploads store only the file name in users.avatar; expose the
  // API-relative endpoint (see toAvatarUrl). Cloudinary / social avatars are
  // https URLs and pass through untouched.
  private avatarUrl(user: UserEntity): string | undefined {
    return toAvatarUrl(user.id, user.avatar) ?? undefined;
  }

  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<FrontendUser> {
    const stored = await this.storage.storeAvatar(userId, file); // https URL (Cloudinary) or file name (local)
    await this.users.update({ id: userId }, { avatar: stored });
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    return this.toFullUser(user);
  }

  async readAvatar(userId: string): Promise<{ buffer: Buffer; mime: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    const v = user?.avatar;
    if (!v || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) {
      throw new BadRequestException('Avatar not found');
    }
    return this.storage.readAvatar(userId, v);
  }
}
