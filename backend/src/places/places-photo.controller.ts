import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';
import { PlaceImageService } from './place-image.service';
import { UserEntity } from '../auth/entities/user.entity';

// Deliberately @Public(): React Native <Image> cannot send the bearer token
// unless REQUIRE_AUTH_FOR_PHOTOS is on. The client only ever supplies a
// strictly validated Google place id or Wikipedia page id — never a photoName
// or URL — and every download is allow-listed server-side.
@Public()
@Controller('places/photo')
export class PlacesPhotoController {
  private readonly logger = new Logger('PlacesPhotoController');
  constructor(
    private readonly images: PlaceImageService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    // Task 4: DB lookup to verify user is active when auth is required.
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  // SEC-4: every cache miss triggers an outbound provider fetch (billable), so
  // each public photo route has its own 120 req/min/IP cap on top of the global
  // limit. Pass-4 (task 10): optional bearer auth (REQUIRE_AUTH_FOR_PHOTOS) is
  // checked INSIDE the handler (not the global guard) because the routes must
  // stay @Public() for the default-off rollout, while RN <Image> can attach
  // the header to the request. The old curated-config route (/places/photo/:id)
  // was removed together with places.config.ts.

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
    @Req() req: Request,
  ): Promise<StreamableFile> {
    await this.requireTokenIfEnabled(req);
    const photo = await this.images.getLiveImage(googlePlaceId);
    if (!photo) throw new NotFoundException('No photo available');
    return this.sendPhoto(res, photo);
  }

  // Photos for places found via Wikipedia nearby search. The client supplies
  // only a numeric page id (validated); the thumbnail URL is resolved and
  // downloaded server-side from the allow-listed Wikimedia host.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('w/:pageId')
  async serveWikiPhoto(
    @Param('pageId') pageId: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    await this.requireTokenIfEnabled(req);
    const photo = await this.images.getWikiPlaceImage(pageId);
    if (!photo) throw new NotFoundException('No photo available');
    return this.sendPhoto(res, photo);
  }

  // Pass-4 (task 10): default OFF so old APKs keep working; the owner flips
  // REQUIRE_AUTH_FOR_PHOTOS=true after rollout. When on, an unverifiable
  // bearer token is a 401 — the same JwtService/secret as every other route.
  // Task 4: also reject tokens whose user is missing or inactive in the DB.
  private async requireTokenIfEnabled(req: Request): Promise<void> {
    if ((this.config.get<string>('REQUIRE_AUTH_FOR_PHOTOS') ?? 'false') !== 'true') return;
    const header = req.headers?.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing access token');
    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      sub = payload.sub;
    } catch {
      // Never echo why — a forged vs expired token is not the caller's business.
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // Task 4: verify the user actually exists and is active (mirrors JwtStrategy).
    const user = await this.users.findOne({ where: { id: sub } });
    if (!user || user.isActive === false) {
      throw new UnauthorizedException('User no longer active');
    }
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