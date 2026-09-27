import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User as FrontendUser } from '../common/frontend-contracts';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { UserEntity } from './entities/user.entity';
import { OtpService } from './otp.service';
import { SMS_PROVIDER, SmsProvider } from './providers/sms-provider.interface';
import { TokenPair, TokensService } from './tokens.service';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { UpdateMeDto } from './dto/update-me.dto';

export interface VerifyOtpResult extends TokenPair {
  user: FrontendUser;
  isNewUser: boolean;
}



@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
  ) {}
  

  // Matches MobileNumberScreen -> POST /auth/otp/send
  async sendOtp({ phone }: SendOtpDto): Promise<{ message: string; expiresInSeconds: number; devOtp?: string }> {
  const code = await this.otp.issue(phone);
  const result = await this.sms.sendOtp(phone, code);
  const response = { message: 'OTP sent', expiresInSeconds: 300 };

  const devModeFlag = (this.config.get<string>('OTP_DEV_MODE') ?? 'true') === 'true';
    // Only exposed in local development. Production must use a real SMS provider.
    return devModeFlag || !result.sent ? { ...response, devOtp: code } : response;
  }

  // Matches OTPVerificationScreen -> POST /auth/otp/verify
  async verifyOtp({ phone, otp, role, name }: VerifyOtpDto): Promise<VerifyOtpResult> {
    const result = await this.otp.verify(phone, otp);
    if (!result.ok) {
      throw new BadRequestException(result.reason ?? 'Invalid OTP');
    }

    let user = await this.users.findOne({ where: { phone } });
    const isNewUser = !user;

    if (!user) {
      // First-time login: RoleSelectionScreen's choice becomes the user's role.
      user = this.users.create({
        phone,
        name: name?.trim() || (role === 'driver' ? 'New Driver' : 'New Rider'),
        role: role ?? null,
        language: 'en',
      });
    } else if (role && !user.role) {
      user.role = role;
    }
    user = await this.users.save(user);

    const tokenPair = this.tokens.issueTokens(user);
    return { ...tokenPair, user: user.toFrontendUser(), isNewUser };
  }
  async googleSignIn(idToken: string, role?: 'rider' | 'driver'): Promise<VerifyOtpResult> {
  const audience = this.config.get<string>('GOOGLE_WEB_CLIENT_ID'); // renamed for clarity
  const ticket = await this.googleClient.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new BadRequestException('Invalid Google token');

  let user = await this.users.findOne({ where: { googleId: payload.sub } });
  const isNewUser = !user;
  if (!user && payload.email) {
    user = await this.users.findOne({ where: { email: payload.email } }); // link if same email already exists
  }
  if (!user) {
    user = this.users.create({
      googleId: payload.sub,
      email: payload.email ?? null,
      name: payload.name || 'New User',
      avatar: payload.picture ?? null,
      role: role ?? null,
      language: 'en',
    });
  } else if (!user.googleId) {
    user.googleId = payload.sub;
  }
  if (role && !user.role) user.role = role;
  user = await this.users.save(user);

  const tokenPair = this.tokens.issueTokens(user);
  return { ...tokenPair, user: user.toFrontendUser(), isNewUser };
}

async appleSignIn(identityToken: string, fullName: string | undefined, role?: 'rider' | 'driver'): Promise<VerifyOtpResult> {
  const payload = await appleSignin.verifyIdToken(identityToken, {
    audience: this.config.get<string>('APPLE_CLIENT_ID'),
  });
  if (!payload?.sub) throw new BadRequestException('Invalid Apple token');

  let user = await this.users.findOne({ where: { appleId: payload.sub } });
  const isNewUser = !user;
  if (!user) {
    user = this.users.create({
      appleId: payload.sub,
      email: payload.email ?? null,
      // Apple only sends fullName on the FIRST sign-in ever — capture it now or lose it.
      name: fullName?.trim() || 'New User',
      role: role ?? null,
      language: 'en',
    });
  } else if (role && !user.role) {
    user.role = role;
  }
  user = await this.users.save(user);

  const tokenPair = this.tokens.issueTokens(user);
  return { ...tokenPair, user: user.toFrontendUser(), isNewUser };
} 
  async findById(userId: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id: userId } });
  }

  async me(userId: string): Promise<FrontendUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return user.toFrontendUser();
  }
  async updateMe(userId: string, dto: UpdateMeDto): Promise<FrontendUser> {
  const user = await this.users.findOne({ where: { id: userId } });
  if (!user) throw new BadRequestException('User not found');

  if (dto.name !== undefined) user.name = dto.name.trim();
  if (dto.email !== undefined) user.email = dto.email;

  const saved = await this.users.save(user);
  return saved.toFrontendUser();
}
}
