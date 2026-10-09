import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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

  @Post('saved')
  upsertSaved(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertSavedPlaceDto): Promise<SavedPlaceDto> {
    return this.service.upsertSaved(user.userId, dto);
  }

  @Delete('saved/:id')
  async deleteSaved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<{ ok: true }> {
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
