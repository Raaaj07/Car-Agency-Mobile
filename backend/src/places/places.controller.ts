import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlacesService } from './places.service';
import { UpsertSavedPlaceDto } from './dto/upsert-saved-place.dto';
import { PlaceItemDto, SavedPlaceDto } from './dto/place-item.dto';

// Authentication is global (SEC-1 default-deny); only the role check stays.
@UseGuards(RolesGuard)
@Roles('rider')
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
    // into `LIMIT $2` and surfaced as a 500. Same isFinite pattern as
    // getNearby below; the service clamps the range (1..10) as well.
    const parsed = limit ? Number.parseInt(limit, 10) : NaN;
    return this.service.getRecent(user.userId, Number.isFinite(parsed) ? parsed : 5);
  }

  // Route throttle: 30/min — nearby triggers a server-side Google Places
  // search (billable per miss); the global 300/min would let one client burn
  // the Places quota alone.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('nearby')
  getNearby(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radius?: string,
  ): Promise<PlaceItemDto[]> {
    const plat = lat ? parseFloat(lat) : NaN;
    const plng = lng ? parseFloat(lng) : NaN;
    const r = radius ? parseInt(radius, 10) : NaN;
    return this.service.getNearby(plat, plng, Number.isFinite(r) ? r : undefined);
  }

  // Same reasoning as nearby: this searches Google Places server-side.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('popular')
  async getPopular(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ): Promise<{ quickPicks: PlaceItemDto[]; popular: PlaceItemDto[]; cityHighlights: PlaceItemDto[] }> {
    return this.service.getPopular(
      lat ? parseFloat(lat) : undefined,
      lng ? parseFloat(lng) : undefined,
    );
  }
}
