import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlacesService } from './places.service';
import { UpsertSavedPlaceDto } from './dto/upsert-saved-place.dto';
import { PlaceItemDto, SavedPlaceDto } from './dto/place-item.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
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
    return this.service.getRecent(user.userId, limit ? parseInt(limit, 10) : 5);
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
