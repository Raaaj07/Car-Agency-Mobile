import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AppSettingEntity } from './entities/app-setting.entity';
import {
  DEFAULT_RADIUS_M,
  DRIVER_RADIUS_KEY,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
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
