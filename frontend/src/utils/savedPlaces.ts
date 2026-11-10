/**
 * Home / Work shortcuts. Pure helpers (no React / network imports) so the rules
 * run in plain Jest.
 *
 * The server keeps ONE saved row per (rider, place) where a place is the
 * latitude / longitude rounded to 4 decimals (about 11 m), and a rider has at
 * most one Home and one Work. Saving a place under a label therefore takes that
 * exact place away from the other label: Work set to the very place that is
 * Home would silently lose Home. These helpers let the screens say so first.
 */

export type PlaceLabel = 'home' | 'work';

export interface PointLike {
  lat: number;
  lng: number;
}

export interface LabelledPlace extends PointLike {
  label?: string | null;
}

export const labelName = (label: PlaceLabel): string => (label === 'home' ? 'Home' : 'Work');

/** Same rounding as the backend geo key: two points with the same key are the same place. */
export const placeKey = (point: PointLike): string => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;

/** The saved place carrying this label, if any. */
export function savedForLabel<T extends LabelledPlace>(saved: T[], label: PlaceLabel): T | undefined {
  return saved.find((place) => place.label === label);
}

/**
 * The OTHER shortcut that already holds this exact place, if any. Saving the
 * place under `label` would move it away from that one, so the caller refuses.
 */
export function conflictingLabel(
  saved: LabelledPlace[],
  label: PlaceLabel,
  point: PointLike,
): PlaceLabel | null {
  const other: PlaceLabel = label === 'home' ? 'work' : 'home';
  const held = savedForLabel(saved, other);
  return held && placeKey(held) === placeKey(point) ? other : null;
}
