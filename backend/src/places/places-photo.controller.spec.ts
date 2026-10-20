import { StreamableFile, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { PlaceImageService } from './place-image.service';
import { PlacesPhotoController } from './places-photo.controller';

/**
 * Pass-4 (task 10): optional bearer auth on the billable photo proxy.
 * Default OFF (old APKs keep working); REQUIRE_AUTH_FOR_PHOTOS=true makes an
 * unverifiable token a 401. The token is verified with the SAME
 * JwtService/secret as the rest of the app.
 * Task 4: when auth is enabled, also reject tokens whose user is missing
 * or inactive in the DB.
 */
describe('PlacesPhotoController optional auth (pass-4 task-10 / task-4)', () => {
  const SECRET = 'photo_secret_test_fake';
  const GOOGLE_ID = 'ChIJfake12345678';

  let images: { getLiveImage: jest.Mock; getWikiPlaceImage: jest.Mock };
  let jwt: JwtService;
  let res: { setHeader: jest.Mock };
  let usersRepo: { findOne: jest.Mock };

  const build = (env: Record<string, string | undefined>, usersOverride?: { findOne: jest.Mock }) =>
    new PlacesPhotoController(
      images as unknown as PlaceImageService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
      jwt,
      (usersOverride ?? usersRepo) as unknown as Repository<UserEntity>,
    );

  const reqWith = (auth?: string) =>
    ({ headers: auth ? { authorization: auth } : {} }) as unknown as Request;

  const photo = () => ({ body: Buffer.from('fake-image-bytes'), contentType: 'image/jpeg' });

  beforeEach(() => {
    images = {
      getLiveImage: jest.fn().mockResolvedValue(photo()),
      getWikiPlaceImage: jest.fn().mockResolvedValue(photo()),
    };
    jwt = new JwtService({ secret: SECRET });
    res = { setHeader: jest.fn() };
    // Default: active user found in DB.
    usersRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'u1', isActive: true }),
    };
  });

  it('serves without a token when the flag is off (default)', async () => {
    const out = await build({}).serveGooglePhoto(GOOGLE_ID, res as unknown as Response, reqWith());

    expect(out).toBeInstanceOf(StreamableFile);
    expect(images.getLiveImage).toHaveBeenCalledWith(GOOGLE_ID);
  });

  it('rejects with 401 when the flag is on and no token is sent', async () => {
    await expect(
      build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }).serveGooglePhoto(
        GOOGLE_ID,
        res as unknown as Response,
        reqWith(),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(images.getLiveImage).not.toHaveBeenCalled();
  });

  it('rejects with 401 on a forged / wrong-secret token', async () => {
    const forged = new JwtService({ secret: 'another_secret' }).sign({ sub: 'u1' });

    await expect(
      build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }).serveGooglePhoto(
        GOOGLE_ID,
        res as unknown as Response,
        reqWith(`Bearer ${forged}`),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(images.getLiveImage).not.toHaveBeenCalled();
  });

  it('serves a valid token for an active user when the flag is on', async () => {
    const token = jwt.sign({ sub: 'u1' });

    const out = await build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }).serveGooglePhoto(
      GOOGLE_ID,
      res as unknown as Response,
      reqWith(`Bearer ${token}`),
    );

    expect(out).toBeInstanceOf(StreamableFile);
  });

  // Task 4: new tests for missing/inactive user rejection.
  it('rejects with 401 when the user is not found in the DB (task-4)', async () => {
    const missingUser = { findOne: jest.fn().mockResolvedValue(null) };
    const token = jwt.sign({ sub: 'u-missing' });

    await expect(
      build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }, missingUser).serveGooglePhoto(
        GOOGLE_ID,
        res as unknown as Response,
        reqWith(`Bearer ${token}`),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(images.getLiveImage).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the user is inactive (task-4)', async () => {
    const inactiveUser = {
      findOne: jest.fn().mockResolvedValue({ id: 'u-inactive', isActive: false }),
    };
    const token = jwt.sign({ sub: 'u-inactive' });

    await expect(
      build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' }, inactiveUser).serveGooglePhoto(
        GOOGLE_ID,
        res as unknown as Response,
        reqWith(`Bearer ${token}`),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(images.getLiveImage).not.toHaveBeenCalled();
  });

  it('applies the same gate to the Wikipedia (w/:pageId) proxy', async () => {
    const gate = build({ REQUIRE_AUTH_FOR_PHOTOS: 'true' });

    await expect(
      gate.serveWikiPhoto('12345', res as unknown as Response, reqWith()),
    ).rejects.toThrow(UnauthorizedException);
    expect(images.getWikiPlaceImage).not.toHaveBeenCalled();

    const out = await gate.serveWikiPhoto(
      '12345',
      res as unknown as Response,
      reqWith(`Bearer ${jwt.sign({ sub: 'u1' })}`),
    );
    expect(out).toBeInstanceOf(StreamableFile);
  });

  it('no longer exposes the old curated-config route (/places/photo/:configId)', () => {
    expect('servePhoto' in build({})).toBe(false);
  });
});
