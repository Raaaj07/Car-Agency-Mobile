/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { DeviceTokenEntity } from './device-token.entity';
import { PushService } from './push.service';

/**
 * Phase-2.2: the driver-offer push is visible on a locked phone. It must say
 * nothing about the pickup address or the fare — only that a request exists —
 * while still carrying the ride id the app needs to open it.
 */
describe('PushService.notifyDriverOffer privacy (Phase 2.2)', () => {
  let service: PushService;
  let tokens: { find: jest.Mock; delete: jest.Mock; upsert: jest.Mock };
  let users: { findOne: jest.Mock; update: jest.Mock };
  let redis: { set: jest.Mock };
  let post: jest.SpyInstance;

  beforeEach(() => {
    tokens = {
      find: jest.fn().mockResolvedValue([
        { id: 't1', userId: 'driver-1', token: 'ExponentPushToken[fake123]' },
      ]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    users = {
      findOne: jest.fn().mockResolvedValue({ id: 'driver-1', pushEnabled: true }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    redis = { set: jest.fn().mockResolvedValue('OK') };
    post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: [] } } as never);

    service = new PushService(
      tokens as unknown as Repository<DeviceTokenEntity>,
      users as unknown as Repository<UserEntity>,
      redis as unknown as Redis,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  afterEach(() => post.mockRestore());

  it('sends a generic body and only the ride id — never address or fare', async () => {
    await service.notifyDriverOffer('driver-1', 'ride-1', 987, 'Secret Pickup Street');

    expect(post).toHaveBeenCalledTimes(1);
    const [, body] = post.mock.calls[0] as [string, Array<Record<string, unknown>>];
    const msg = body[0];

    expect(msg.body).toBe('Tap to view the request');
    expect(msg.data).toEqual({ type: 'ride_offer', rideId: 'ride-1' });
    const serialized = JSON.stringify(msg);
    expect(serialized).not.toContain('Secret Pickup');
    expect(serialized).not.toContain('987');
  });

  it('still dedupes per ride+driver before pushing', async () => {
    redis.set.mockResolvedValue(null); // key already existed (NX failed)

    await service.notifyDriverOffer('driver-1', 'ride-1', 987, 'Secret Pickup Street');

    expect(post).not.toHaveBeenCalled();
  });
});
