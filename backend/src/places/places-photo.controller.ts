import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { PLACES_CONFIG } from './places.config';
import { GooglePlacesService } from './google-places.service';
import { PlaceImageService } from './place-image.service';

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
  constructor(
    private readonly google: GooglePlacesService,
    private readonly images: PlaceImageService,
  ) {}

  // Curated places: Google photo -> curated URL -> Wikimedia search, all
  // downloaded server-side and streamed to the app.
  @Get(':configId')
  async servePhoto(
    @Param('configId') configId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const item = CURATED_BY_ID.get(configId);
    if (!item) throw new NotFoundException('Unknown place photo');
    const photo = await this.images.getCuratedImage(item);
    if (!photo) throw new NotFoundException('No photo available');
    return this.sendPhoto(res, photo);
  }

  // Guard-free photo proxy for live nearby results. The client supplies
  // only a Google place ID (strictly validated); photo bytes are resolved
  // and downloaded server-side, so the key never reaches the app.
  @Get('g/:googlePlaceId')
  async serveGooglePhoto(
    @Param('googlePlaceId') googlePlaceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const photo = await this.google.fetchPlacePhotoById(googlePlaceId);
    if (!photo) throw new NotFoundException('No photo available');
    return this.sendPhoto(res, photo);
  }

  // IMPORTANT: a raw Buffer returned from a Nest handler is serialised with
  // res.json() ({"type":"Buffer","data":[...]}), which the phone cannot decode
  // ("unknown image format"). StreamableFile sends the real binary bytes.
  private sendPhoto(res: Response, photo: { body: Buffer; contentType: string }): StreamableFile {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(photo.body, {
      type: photo.contentType,
      length: photo.body.length,
    });
  }
}