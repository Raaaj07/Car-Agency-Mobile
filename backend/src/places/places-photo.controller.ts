import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PLACES_CONFIG } from './places.config';
import { PlaceImageService } from './place-image.service';

// Deliberately NOT guarded: React Native <Image> cannot send the bearer
// token. Security comes from the fixed allow-list — only curated config IDs
// are servable, and the client can never pass a photoName or URL.
const CURATED_BY_ID = new Map(
  [...PLACES_CONFIG.quickPicks, ...PLACES_CONFIG.popular, ...PLACES_CONFIG.cityHighlights].map(
    (item) => [item.id, item] as const,
  ),
);

@Public()
@Controller('places/photo')
export class PlacesPhotoController {
  private readonly logger = new Logger('PlacesPhotoController');
  constructor(private readonly images: PlaceImageService) {}

  // Curated places: Google photo -> curated URL -> Wikimedia search, all
  // downloaded server-side and streamed to the app. SEC-4: each cache miss
  // triggers an outbound provider fetch (billable Google Places API), so the
  // public route gets its own 120 req/min/IP cap on top of the global limit.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
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

  // Guard-free photo proxy for live nearby/popular results. The client
  // supplies only a Google place ID (strictly validated); bytes are resolved
  // and downloaded server-side (Google first, Wikimedia as backup), so the
  // key never reaches the app and the phone never hits Wikimedia directly.
  // SEC-4: live lookups are billable per cache miss — same 120 req/min/IP cap.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('g/:googlePlaceId')
  async serveGooglePhoto(
    @Param('googlePlaceId') googlePlaceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const photo = await this.images.getLiveImage(googlePlaceId);
    if (!photo) throw new NotFoundException('No photo available');
    return this.sendPhoto(res, photo);
  }

  // IMPORTANT: a raw Buffer returned from a Nest handler is serialised with
  // res.json() ({"type":"Buffer","data":[...]}), which the phone cannot decode
  // ("unknown image format"). StreamableFile sends the real binary bytes.
  private sendPhoto(res: Response, photo: { body: Buffer; contentType: string }): StreamableFile {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return (
      new StreamableFile(photo.body, {
        type: photo.contentType,
        length: photo.body.length,
      })
        // The source is an in-memory Buffer (it cannot fail), so any stream
        // error here means the phone dropped the socket mid-image — routine
        // on mobile (list recycling). Keep those at debug, not ERROR.
        .setErrorLogger((err) => this.logger.debug(`photo stream ended early: ${err.message}`))
    );
  }
}