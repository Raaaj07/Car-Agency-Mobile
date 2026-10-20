import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Ip, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { GoogleSignInDto, AppleSignInDto, RefreshTokenDto } from './dto/social-signin.dto';
import { UpdateMeDto } from './dto/update-me.dto';


@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // AU-1: per-IP backstop on top of OtpService's per-phone limits — an
  // attacker rotating victim numbers is capped here (10 sends / 10 min / IP).
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  sendOtp(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto);
  }

  // Verification is capped per IP too; per-phone brute force is stopped by
  // OtpService's 5-attempts-per-code counter + the send window cap.
  // Pass-4 (task 4): the client IP also feeds OtpService's per-IP
  // failed-verify cap (bounds an attacker rotating through many numbers).
  @Public()
  @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.verifyOtp(dto, ip, userAgent);
  }

  // SEC-3: refresh presents a refresh token (not a bearer), so it stays
  // public — but brute-forcing the rotation space is capped here.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // SEC-3: each call verifies a token against Google/Apple — throttle the
  // outbound verification cost too.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @Post('google')
  @HttpCode(HttpStatus.OK)
  googleSignIn(@Body() dto: GoogleSignInDto, @Headers('user-agent') userAgent?: string) {
    return this.auth.googleSignIn(dto.idToken, userAgent);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  appleSignIn(@Body() dto: AppleSignInDto, @Headers('user-agent') userAgent?: string) {
    return this.auth.appleSignIn(dto.identityToken, dto.fullName, userAgent);
  }

  // From here down: default-deny (global JwtAuthGuard — no @Public needed).
  // Task 2: logout accepts the refresh token in the body to revoke only the
  // current device session. Old clients that omit it revoke all sessions.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: AuthenticatedUser, @Body() body: { refreshToken?: string }) {
    return this.auth.logout(user.userId, body?.refreshToken, user.sessionId);
  }

  // Task 2: "log out everywhere" — revokes all sessions for this user.
  @Post('logout-everywhere')
  @HttpCode(HttpStatus.OK)
  logoutEverywhere(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutEverywhere(user.userId);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(user.userId, dto);
  }

  // Pass-4 (task 12): compliance account deletion (Play + Apple 5.1.1(v)).
  // 3/hour: destructive + audit-writing — a scripted loop is never a
  // legitimate user action. Refuses with 409 while an active ride is held.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Delete('me')
  @HttpCode(HttpStatus.OK)
  deleteMe(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.deleteMe(user.userId);
  }

  // Route throttle: 5/min — an avatar is a human-paced action, but the
  // endpoint stores bytes + hits Cloudinary, so scripted loops are capped.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('avatar', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }),
  )
  uploadAvatar(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    return this.auth.uploadAvatar(user.userId, file);
  }
}
