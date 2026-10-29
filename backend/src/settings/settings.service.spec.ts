import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AppSettingEntity } from './entities/app-setting.entity';
import {
  DEFAULT_OFFER_TIMEOUT_S,
  DEFAULT_RADIUS_M,
  DRIVER_RADIUS_KEY,
  MAX_OFFER_TIMEOUT_S,
  MAX_RADIUS_M,
  MIN_OFFER_TIMEOUT_S,
  MIN_RADIUS_M,
  OFFER_TIMEOUT_KEY,
  offerTimeoutFromEnv,
  SettingsService,
} from './settings.service';

describe('SettingsService (admin-editable driver search radius)', () => {
  let repo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let service: SettingsService;

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((row: unknown) => row),
    };
    service = new SettingsService(repo as unknown as Repository<AppSettingEntity>);
  });

  it('defaults to 10 km until an admin saves a value', async () => {
    expect(await service.getSearchRadiusMeters()).toBe(DEFAULT_RADIUS_M);
    expect(DEFAULT_RADIUS_M).toBe(10_000);
  });

  it('reads the saved value', async () => {
    repo.findOne.mockResolvedValue({ key: DRIVER_RADIUS_KEY, value: '7500', updatedBy: 'admin-1', updatedAt: new Date() });
    expect(await service.getSearchRadiusMeters()).toBe(7_500);
  });

  it('ignores a corrupt stored value and serves the default', async () => {
    repo.findOne.mockResolvedValue({ key: DRIVER_RADIUS_KEY, value: 'not-a-number' });
    expect(await service.getSearchRadiusMeters()).toBe(DEFAULT_RADIUS_M);
    repo.findOne.mockResolvedValue({ key: DRIVER_RADIUS_KEY, value: '999999999' });
    service = new SettingsService(repo as unknown as Repository<AppSettingEntity>);
    expect(await service.getSearchRadiusMeters()).toBe(DEFAULT_RADIUS_M);
  });

  it('serves the default (matching keeps working) when the table cannot be read', async () => {
    repo.findOne.mockRejectedValue(new Error('relation "app_settings" does not exist'));
    expect(await service.getSearchRadiusMeters()).toBe(DEFAULT_RADIUS_M);
  });

  it('caches the value, and a save is visible immediately on this instance', async () => {
    repo.findOne.mockResolvedValue({ key: DRIVER_RADIUS_KEY, value: '5000', updatedBy: null, updatedAt: new Date() });
    expect(await service.getSearchRadiusMeters()).toBe(5_000);
    expect(await service.getSearchRadiusMeters()).toBe(5_000);
    expect(repo.findOne).toHaveBeenCalledTimes(1); // second read came from the cache

    const saved = await service.setSearchRadiusMeters(12_000, 'admin-1');
    expect(saved.radiusMeters).toBe(12_000);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ key: DRIVER_RADIUS_KEY, value: '12000', updatedBy: 'admin-1' }),
    );
    expect(await service.getSearchRadiusMeters()).toBe(12_000); // no stale 5 km
    expect(repo.findOne).toHaveBeenCalledTimes(1);
  });

  it('rejects radii outside 1-50 km and non-numbers', async () => {
    await expect(service.setSearchRadiusMeters(MIN_RADIUS_M - 1, 'a')).rejects.toThrow(BadRequestException);
    await expect(service.setSearchRadiusMeters(MAX_RADIUS_M + 1, 'a')).rejects.toThrow(BadRequestException);
    await expect(service.setSearchRadiusMeters(Number.NaN, 'a')).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('accepts the exact bounds', async () => {
    await expect(service.setSearchRadiusMeters(MIN_RADIUS_M, 'a')).resolves.toMatchObject({ radiusMeters: 1_000 });
    await expect(service.setSearchRadiusMeters(MAX_RADIUS_M, 'a')).resolves.toMatchObject({ radiusMeters: 50_000 });
  });
});

describe('SettingsService (admin-editable offer timeout)', () => {
  let repo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let service: SettingsService;

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((row: unknown) => row),
    };
    service = new SettingsService(repo as unknown as Repository<AppSettingEntity>);
  });

  it('uses the fallback (env default) until an admin saves a value', async () => {
    expect(await service.getOfferTimeoutSeconds()).toBe(DEFAULT_OFFER_TIMEOUT_S);
    expect(await service.getOfferTimeoutSeconds(25)).toBe(25);
    expect(await service.getOfferTimeout(25)).toMatchObject({ seconds: 25, isDefault: true });
  });

  it('reads the saved value and prefers it over the fallback', async () => {
    repo.findOne.mockResolvedValue({ key: OFFER_TIMEOUT_KEY, value: '30', updatedBy: 'admin-1', updatedAt: new Date() });
    expect(await service.getOfferTimeoutSeconds(15)).toBe(30);
    expect(await service.getOfferTimeout(15)).toMatchObject({ seconds: 30, isDefault: false, updatedBy: 'admin-1' });
  });

  it('ignores a corrupt or out-of-range stored value and serves the fallback', async () => {
    repo.findOne.mockResolvedValue({ key: OFFER_TIMEOUT_KEY, value: 'soon' });
    expect(await service.getOfferTimeoutSeconds(15)).toBe(15);
    service = new SettingsService(repo as unknown as Repository<AppSettingEntity>);
    repo.findOne.mockResolvedValue({ key: OFFER_TIMEOUT_KEY, value: '9999' });
    expect(await service.getOfferTimeoutSeconds(15)).toBe(15);
  });

  it('serves the fallback (offers keep working) when the table cannot be read', async () => {
    repo.findOne.mockRejectedValue(new Error('relation "app_settings" does not exist'));
    expect(await service.getOfferTimeoutSeconds(15)).toBe(15);
  });

  it('a save is visible immediately and is stored under its own key', async () => {
    expect(await service.getOfferTimeoutSeconds(15)).toBe(15);
    const saved = await service.setOfferTimeoutSeconds(40, 'admin-1');
    expect(saved).toMatchObject({ seconds: 40, isDefault: false });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ key: OFFER_TIMEOUT_KEY, value: '40', updatedBy: 'admin-1' }),
    );
    expect(await service.getOfferTimeoutSeconds(15)).toBe(40);
  });

  it('keeps the radius and the offer timeout independent (separate cache entries)', async () => {
    repo.findOne.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === DRIVER_RADIUS_KEY
        ? { key: DRIVER_RADIUS_KEY, value: '7000', updatedBy: null, updatedAt: new Date() }
        : { key: OFFER_TIMEOUT_KEY, value: '20', updatedBy: null, updatedAt: new Date() },
    );
    expect(await service.getSearchRadiusMeters()).toBe(7_000);
    expect(await service.getOfferTimeoutSeconds(15)).toBe(20);
  });

  it('rejects 9 s, 61 s and non-numbers; accepts the exact bounds', async () => {
    await expect(service.setOfferTimeoutSeconds(MIN_OFFER_TIMEOUT_S - 1, 'a')).rejects.toThrow(BadRequestException);
    await expect(service.setOfferTimeoutSeconds(MAX_OFFER_TIMEOUT_S + 1, 'a')).rejects.toThrow(BadRequestException);
    await expect(service.setOfferTimeoutSeconds(Number.NaN, 'a')).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
    await expect(service.setOfferTimeoutSeconds(MIN_OFFER_TIMEOUT_S, 'a')).resolves.toMatchObject({ seconds: 10 });
    await expect(service.setOfferTimeoutSeconds(MAX_OFFER_TIMEOUT_S, 'a')).resolves.toMatchObject({ seconds: 60 });
  });

  it('offerTimeoutFromEnv keeps the old env behaviour and defaults to 15', () => {
    expect(offerTimeoutFromEnv(undefined)).toBe(15);
    expect(offerTimeoutFromEnv('abc')).toBe(15);
    expect(offerTimeoutFromEnv(0)).toBe(15);
    expect(offerTimeoutFromEnv('20')).toBe(20);
    expect(offerTimeoutFromEnv(12.4)).toBe(12);
  });
});
