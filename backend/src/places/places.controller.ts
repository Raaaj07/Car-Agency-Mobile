import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlacesService } from './places.service';
import { UpsertSavedPlaceDto } from './dto/upsert-saved-place.dto';
import { PlaceItemDto, SavedPlaceDto } from './dto/place-item.dto';

// Authentication is global (SEC-1 default-deny); only the role check stays.
// Accounts are unified: a user whose DB role is 'driver' (or 'admin') still
// uses the rider home screen when the app is in rider mode, so every role may
// call these routes. All queries are scoped to the caller's own userId.
@UseGuards(RolesGuard)
@Roles('rider', 'driver', 'admin')
@Controller('places')
export class PlacesController {
  constructor(private readonly service: PlacesService) {}

  @Get('saved')
  getSaved(@CurrentUser() user: AuthenticatedUser): Promise<SavedPlaceDto[]> {
    return this.service.getSaved(user.userId);
  }

  // Route throttle: 20/min — saved-place writes are user-paced taps, not a
  // stream; the cap bounds DB churn from a scripted loop.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('saved')
  upsertSaved(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertSavedPlaceDto): Promise<SavedPlaceDto> {
    return this.service.upsertSaved(user.userId, dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Delete('saved/:id')
  async deleteSaved(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.service.deleteSaved(user.userId, id);
    return { ok: true };
  }

  @Get('recent')
  getRecent(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<PlaceItemDto[]> {
    // SEC-5: ?limit=abc passed the truthy check and arrived as NaN — which
    // slipped through the service's clamp (every NaN comparison is false)
    // into `LIMIT $2` and surfaced as a 500. The service clamps the range
    // (1..10) as well.
    const parsed = limit ? Number.parseInt(limit, 10) : NaN;
    return this.service.getRecent(user.userId, Number.isFinite(parsed) ? parsed : 5);
  }

  // The rider's most-visited drop-offs (their own ride history, no photos).
  @Get('frequent')
  getFrequent(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<PlaceItemDto[]> {
    const parsed = limit ? Number.parseInt(limit, 10) : NaN;
    return this.service.getFrequent(user.userId, Number.isFinite(parsed) ? parsed : 5);
  }

  // Home screen, right under recents: nearest bus stands, railway stations and
  // colleges. The app calls this ONCE per app launch. Each cache miss is a
  // billable Google search, hence the 30/min route throttle.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('big')
  getBig(@Query('lat') lat?: string, @Query('lng') lng?: string): Promise<PlaceItemDto[]> {
    return this.service.getBigPlaces(lat ? parseFloat(lat) : NaN, lng ? parseFloat(lng) : NaN);
  }

  // Home screen "Popular Places": well-rated sights near the rider. Called once
  // per app launch.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('popular')
  getPopular(@Query('lat') lat?: string, @Query('lng') lng?: string): Promise<PlaceItemDto[]> {
    return this.service.getPopular(lat ? parseFloat(lat) : NaN, lng ? parseFloat(lng) : NaN);
  }
}
