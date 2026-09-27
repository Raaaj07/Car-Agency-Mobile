import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserEntity } from './entities/user.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OtpService } from './otp.service';
import { DevSmsProvider } from './providers/dev-sms.provider';
import { Msg91SmsProvider } from './providers/msg91-sms.provider';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    PassportModule,
    HttpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokensService,
    JwtStrategy,
    JwtAuthGuard,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, DevSmsProvider, Msg91SmsProvider],
      useFactory: (config: ConfigService, dev: DevSmsProvider, msg91: Msg91SmsProvider) =>
        (config.get<string>('OTP_DEV_MODE') ?? 'true') === 'true' ? dev : msg91,
    },
    DevSmsProvider,
    Msg91SmsProvider,
  ],
  exports: [AuthService, TokensService, JwtStrategy, JwtAuthGuard, TypeOrmModule],
})
export class AuthModule {}
