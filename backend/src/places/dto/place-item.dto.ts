export class PlaceItemDto {
  id!: string;
  title!: string;
  subtitle!: string;
  lat!: number;
  lng!: number;
  imageUrl!: string | null;
  saved?: boolean;
  savedId?: string | null;
}

export class SavedPlaceDto {
  id!: string;
  label?: string | null;
  title!: string;
  address!: string;
  lat!: number;
  lng!: number;
}
