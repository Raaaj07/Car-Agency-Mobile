import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EXPO_TOKEN_RE, PushService } from './push.service';

class RegisterTokenDto {
  @IsString()
  @Matches(EXPO_TOKEN_RE, { message: 'token must be an Expo push token' })
  token!: string;

  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;
}

class UnregisterTokenDto {
  @IsString()
  @Matches(EXPO_TOKEN_RE)
  token!: string;
}

class PreferencesDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly push: PushService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterTokenDto) {
    await this.push.register(user.userId, dto.token, dto.platform ?? 'android', user.sessionId);
    return { ok: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('token')
  async unregister(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnregisterTokenDto) {
    await this.push.unregister(user.userId, dto.token);
    return { ok: true };
  }

  @Get('preferences')
  async getPrefs(@CurrentUser() user: AuthenticatedUser) {
    return { enabled: await this.push.getEnabled(user.userId) };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put('preferences')
  async setPrefs(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreferencesDto) {
    await this.push.setEnabled(user.userId, dto.enabled);
    return { enabled: dto.enabled };
  }
}
