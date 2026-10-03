import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PLACES_CONFIG } from './places.config';
import { GooglePlacesService } from './google-places.service';

// Deliberately NOT guarded: React Native <Image> cannot send the bearer
// token. Security comes from the fixed allow-list — only curated config IDs
// are servable, and the client can never pass a photoName or URL.
const CURATED_BY_ID = new Map(
  [...PLACES_CONFIG.quickPicks, ...PLACES_CONFIG.popular, ...PLACES_CONFIG.cityHighlights].map(
    (item) => [item.id, item] as const,
  ),
);

@Controller('places/photo')
export class PlacesPhotoController {
  constructor(private readonly photos: GooglePlacesService) {}

  @Get(':configId')
  async servePhoto(@Param('configId') configId: string, @Res({ passthrough: true }) res: Response) {
    const item = CURATED_BY_ID.get(configId);
    if (!item) throw new NotFoundException('Unknown place photo');
    const photo = await this.photos.fetchPlacePhoto(item);
    if (!photo) throw new NotFoundException('No photo available');
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', String(photo.body.length));
    return photo.body;
  }
}
