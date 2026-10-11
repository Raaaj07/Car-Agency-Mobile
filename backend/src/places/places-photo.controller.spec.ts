import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PlaceImageService } from './place-image.service';
import { PlacesPhotoController } from './places-photo.controller';
import { PLACES_CONFIG } from './places.config';

/**
 * Pass-4 (task 10): optional bearer auth on the billable photo proxy.
 * Default OFF (old APKs keep working); REQUIRE_AUTH_FOR_PHOTOS=true makes an
 * unverifiable token a 401. The token is verified with the SAME
 * JwtService/secret as the rest of the app.
 */
describe('PlacesPhotoController optional auth (pass-4 task-10)', () => {
  const SECRET = 'photo_secret_test_fake';
  const curatedId = PLACES_CONFIG.quickPicks[0]?.id ?? PLACES_CONFIG.popular[0]?.id ?? 'x';

  let images: { getCuratedImage: jest.Mock; getLiveImage: jest.Mock };
  let jwt: JwtService;
  let res: { setHeader: jest.Mock };

  const build = (env: Record<string, string | undefined>) =>
    new PlacesPhotoController(
      images as unknown as PlaceImageService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
      jwt,
    );

  const reqWith = (auth?: string) =>
    ({ headers: auth ? { authorization: auth } : {} }) as unknown as Request;

  beforeEach(() => {
    images = {
      getCuratedImage: jest.fn().mockResolvedValue({
        body: Buffer.from('fake-image-bytes'),
        contentType: 'image/jpeg',
      }),
      getLiveImage: jest.fn().mockResolvedValue({
        body: Buffer.from('fake-image-bytes'),
        contentType: 'image/jpeg',
      }),
    };
    jwt = new JwtService({ secret: SECRET });
    res = { setHeader: jest.fn() };
  });

  it('serves without a token when the flag is off (default)', async () => {
    const out = await build({}).servePhoto(
      curatedId,
      res as unknown as Response,
      reqWith(),
    );

    expect(out).toBeInstanceOf(StreamableFile);
    expect(images.getCuratedImage).toHaveBeenCalled();
  });

  it('rejects with 401 when the flag is on and no token is sent', async () => {
    await expect(
      build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }).servePhoto(
        curatedId,
        res as unknown as Response,
        reqWith(),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(images.getCuratedImage).not.toHaveBeenCalled();
  });

  it('rejects with 401 on a forged / wrong-secret token', async () => {
    const forged = new JwtService({ secret: 'another_secret' }).sign({ sub: 'u1' });

    await expect(
      build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }).servePhoto(
        curatedId,
        res as unknown as Response,
        reqWith(`Bearer ${forged}`),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('serves a valid token when the flag is on', async () => {
    const token = jwt.sign({ sub: 'u1' });

    const out = await build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }).servePhoto(
      curatedId,
      res as unknown as Response,
      reqWith(`Bearer ${token}`),
    );

    expect(out).toBeInstanceOf(StreamableFile);
  });

  it('applies the same gate to the live (g/:id) proxy', async () => {
    const gate = build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' });

    await expect(
      gate.serveGooglePhoto('ChIJfake', res as unknown as Response, reqWith()),
    ).rejects.toThrow(UnauthorizedException);
    expect(images.getLiveImage).not.toHaveBeenCalled();
  });
});
