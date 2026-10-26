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
   * Only present on the location-aware list (/places/nearby).
   */
  distanceKm?: number | null;
  /** Google star rating (0-5). Present on live Google places only. */
  rating?: number | null;
  /** Number of Google ratings behind `rating`. */
  ratingCount?: number | null;
  /** How many trips this rider has taken to the place (/places/frequent only). */
  visitCount?: number;
}

export class SavedPlaceDto {
  id!: string;
  label?: string | null;
  title!: string;
  address!: string;
  lat!: number;
  lng!: number;
}
