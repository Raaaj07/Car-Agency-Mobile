import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { GoogleSignInDto, AppleSignInDto, RefreshTokenDto } from './dto/social-signin.dto';
import { UpdateMeDto } from './dto/update-me.dto';


@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // AU-1: per-IP backstop on top of OtpService's per-phone limits — an
  // attacker rotating victim numbers is capped here (10 sends / 10 min / IP).
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  sendOtp(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto);
  }

  // Verification is capped per IP too; per-phone brute force is stopped by
  // OtpService's 5-attempts-per-code counter + the send window cap.
  @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  googleSignIn(@Body() dto: GoogleSignInDto) {
    return this.auth.googleSignIn(dto.idToken);
  }

  @Post('apple')
  @HttpCode(HttpStatus.OK)
  appleSignIn(@Body() dto: AppleSignInDto) {
    return this.auth.appleSignIn(dto.identityToken, dto.fullName);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('avatar', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }),
  )
  uploadAvatar(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    return this.auth.uploadAvatar(user.userId, file);
  }
}
