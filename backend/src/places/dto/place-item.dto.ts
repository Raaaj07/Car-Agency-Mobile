export class PlaceItemDto {
  id!: string;
  title!: string;
  subtitle!: string;
  lat!: number;
  lng!: number;
  imageUrl!: string | null;
  saved?: boolean;
  savedId?: string | null;
  /**
   * Straight-line distance from the rider's current location, in km (1 decimal).
   * Only present on location-aware lists (/places/nearby, /places/popular
   * called with lat/lng).
   */
  distanceKm?: number | null;
  /** Google star rating (0-5). Present on live Google places only. */
  rating?: number | null;
  /** Number of Google ratings behind `rating`. */
  ratingCount?: number | null;
}

export class SavedPlaceDto {
  id!: string;
  label?: string | null;
  title!: string;
  address!: string;
  lat!: number;
  lng!: number;
}
