import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, Max, Min, ValidateNested } from 'class-validator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { renderSharedTripHtml, SafetyService } from './safety.service';

class EmergencyContactDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be 10-15 digits, optional leading +' })
  phone!: string;
}

class LatLngDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

class SosDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LatLngDto)
  location?: LatLngDto;
}

@Controller('safety')
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Get('emergency-contact')
  getContact(@CurrentUser() user: AuthenticatedUser) {
    return this.safety.getEmergencyContact(user.userId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put('emergency-contact')
  setContact(@CurrentUser() user: AuthenticatedUser, @Body() dto: EmergencyContactDto) {
    return this.safety.setEmergencyContact(user.userId, dto.name.trim(), dto.phone);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('emergency-contact')
  clearContact(@CurrentUser() user: AuthenticatedUser) {
    return this.safety.setEmergencyContact(user.userId, null, null);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('rides/:id/share')
  share(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.safety.createShare(id, user.userId);
  }

  @Delete('rides/:id/share')
  unshare(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.safety.revokeShare(id, user.userId);
  }

  // Not heavily throttled: a panicked user must never be rate-limited out.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('rides/:id/sos')
  sos(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SosDto) {
    return this.safety.raiseSos(id, user.userId, dto?.location);
  }

  // Public, read-only: the token IS the credential (192-bit random, stored hashed).
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('share/:token')
  viewJson(@Param('token') token: string) {
    return this.safety.viewShared(token);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('share/:token/view')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async viewHtml(@Param('token') token: string) {
    return renderSharedTripHtml(await this.safety.viewShared(token), token);
  }
}
