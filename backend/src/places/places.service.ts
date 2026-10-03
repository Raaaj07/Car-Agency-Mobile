import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedPlaceEntity } from './entities/saved-place.entity';
import { UpsertSavedPlaceDto } from './dto/upsert-saved-place.dto';
import { PlaceItemDto, SavedPlaceDto } from './dto/place-item.dto';
import { RideEntity } from '../rides/entities/ride.entity';
import { haversineKm } from '../common/geo-utils';
import { PLACES_CONFIG, PlaceConfigItem } from './places.config';

function makeGeoKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(SavedPlaceEntity)
    private readonly savedPlaces: Repository<SavedPlaceEntity>,
    @InjectRepository(RideEntity)
    private readonly rides: Repository<RideEntity>,
  ) {}

  async getSaved(userId: string): Promise<SavedPlaceDto[]> {
    const places = await this.savedPlaces.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return places.map((p) => ({
      id: p.id,
      label: p.label,
      title: p.title,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
    }));
  }

  async upsertSaved(userId: string, dto: UpsertSavedPlaceDto): Promise<SavedPlaceDto> {
    const geoKey = makeGeoKey(dto.lat, dto.lng);

    // If a label (home/work) is being set, remove the previous entry with that label for this user.
    if (dto.label) {
      await this.savedPlaces.delete({ userId, label: dto.label });
    }

    // Upsert by (userId, geoKey).
    const existing = await this.savedPlaces.findOne({ where: { userId, geoKey } });
    if (existing) {
      existing.title = dto.title;
      existing.address = dto.address;
      if (dto.label !== undefined) existing.label = dto.label ?? null;
      const saved = await this.savedPlaces.save(existing);
      return { id: saved.id, label: saved.label, title: saved.title, address: saved.address, lat: saved.lat, lng: saved.lng };
    }

    const entity = this.savedPlaces.create({
      userId,
      title: dto.title,
      address: dto.address,
      lat: dto.lat,
      lng: dto.lng,
      geoKey,
      label: dto.label ?? null,
    });
    const saved = await this.savedPlaces.save(entity);
    return { id: saved.id, label: saved.label, title: saved.title, address: saved.address, lat: saved.lat, lng: saved.lng };
  }

  async deleteSaved(userId: string, id: string): Promise<void> {
    const place = await this.savedPlaces.findOne({ where: { id } });
    if (!place || place.userId !== userId) throw new NotFoundException('Saved place not found');
    await this.savedPlaces.delete({ id });
  }

  async getRecent(userId: string, limit = 5): Promise<PlaceItemDto[]> {
    const clampedLimit = Math.min(Math.max(1, limit), 10);
    // Distinct dropoff by geoKey (lat/lng rounded to 4 decimals), newest first.
    // Exclude system-cancelled rides.
    const rows = await this.rides.query(
      `SELECT DISTINCT ON (geo_key) geo_key, title, addr, lat, lng, created_at
       FROM (
         SELECT
           round(CAST((r.dropoff->>'lat') AS numeric), 4)::text || ',' || round(CAST((r.dropoff->>'lng') AS numeric), 4)::text AS geo_key,
           r.dropoff->>'address' AS addr,
           split_part(r.dropoff->>'address', ',', 1) AS title,
           CAST(r.dropoff->>'lat' AS double precision) AS lat,
           CAST(r.dropoff->>'lng' AS double precision) AS lng,
           r."createdAt" AS created_at
         FROM rides r
         WHERE r."riderId" = $1
           AND NOT (r.status = 'cancelled' AND r."cancelledBy" = 'system')
           AND r.dropoff IS NOT NULL
       ) sub
       ORDER BY geo_key, created_at DESC
       LIMIT $2`,
      [userId, clampedLimit * 3],
    ) as Array<{ geo_key: string; title: string; addr: string; lat: number; lng: number; created_at: Date }>;

    // Sort by most recent and take top N.
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const topRows = rows.slice(0, clampedLimit);

    // Lookup saved status.
    const geoKeys = topRows.map((r) => r.geo_key);
    const saved = geoKeys.length > 0
      ? await this.savedPlaces.createQueryBuilder('sp')
          .where('sp.userId = :userId AND sp.geoKey IN (:...keys)', { userId, keys: geoKeys })
          .getMany()
      : [];
    const savedMap = new Map(saved.map((s) => [s.geoKey, s]));

    return topRows.map((r) => {
      const sp = savedMap.get(r.geo_key);
      return {
        id: `recent-${r.geo_key}`,
        title: r.title || r.addr,
        subtitle: r.addr,
        lat: Number(r.lat),
        lng: Number(r.lng),
        imageUrl: null,
        saved: !!sp,
        savedId: sp?.id ?? null,
      };
    });
  }

  getPopular(lat?: number, lng?: number): { quickPicks: PlaceItemDto[]; popular: PlaceItemDto[]; cityHighlights: PlaceItemDto[] } {
    const sort = (items: PlaceConfigItem[]): PlaceItemDto[] => {
      const mapped: PlaceItemDto[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        lat: item.lat,
        lng: item.lng,
        imageUrl: item.imageUrl ?? null,
      }));
      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        const ref = { lat, lng };
        mapped.sort((a, b) => haversineKm(ref, a) - haversineKm(ref, b));
      }
      return mapped;
    };

    return {
      quickPicks: sort(PLACES_CONFIG.quickPicks),
      popular: sort(PLACES_CONFIG.popular),
      cityHighlights: sort(PLACES_CONFIG.cityHighlights),
    };
  }
}
