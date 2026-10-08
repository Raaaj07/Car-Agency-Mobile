/**
 * placesStore – Zustand store for home-screen place data.
 *
 * fetchAll() runs 5 requests with Promise.allSettled so one failure does not
 * blank all sections. Anything that failed is retried ONCE, silently, after a
 * short delay; the "Tap to retry" error only appears if every request still
 * failed. Results are cached for 60 s (skip re-fetch unless forced).
 *
 * toggleSaved() does an optimistic update and rolls back on API failure.
 */
import { create } from 'zustand';
import { placesApi, PlaceItem, PopularPlacesResponse, SavedPlace } from '../api/places';
import { promosApi, Promo } from '../api/promos';

// ── State ────────────────────────────────────────────────────────────────────

interface PlacesState {
  recent: PlaceItem[];
  saved: SavedPlace[];
  nearby: PlaceItem[];
  quickPicks: PlaceItem[];
  popular: PlaceItem[];
  cityHighlights: PlaceItem[];
  promos: Promo[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  /** Rider location the nearby/popular lists were last fetched for (drives re-fetch on movement). */
  suggestionsCoords: { lat: number; lng: number } | null;

  fetchAll: (coords?: { lat: number; lng: number }, force?: boolean) => Promise<void>;
  toggleSaved: (place: PlaceItem) => Promise<void>;
  setHomeWork: (label: 'home' | 'work', place: PlaceItem) => Promise<void>;
}

// ── Store ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds
const RETRY_DELAY_MS = 1500; // pause before the single silent retry

export const usePlacesStore = create<PlacesState>((set, get) => ({
  recent: [],
  saved: [],
  nearby: [],
  quickPicks: [],
  popular: [],
  cityHighlights: [],
  promos: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
  suggestionsCoords: null,

  fetchAll: async (coords, force = false) => {
    const { lastFetchedAt, loading } = get();
    if (loading) return;
    if (
      !force &&
      lastFetchedAt !== null &&
      Date.now() - lastFetchedAt < CACHE_TTL_MS
    ) {
      return;
    }

    set({ loading: true, error: null });

    const tasks: (() => Promise<unknown>)[] = [
      () => placesApi.getRecent(5),
      () => placesApi.getSaved(),
      () => placesApi.getPopular(coords),
      () => promosApi.getActive(),
      () => (coords ? placesApi.getNearby(coords) : Promise.resolve([] as PlaceItem[])),
    ];
    const results = await Promise.allSettled(tasks.map((t) => t()));

    // One silent retry of whatever failed (no error shown, spinner state unchanged).
    const failedIdx = results.flatMap((r, i) => (r.status === 'rejected' ? [i] : []));
    if (failedIdx.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      const again = await Promise.allSettled(failedIdx.map((i) => tasks[i]()));
      failedIdx.forEach((originalIdx, k) => {
        results[originalIdx] = again[k];
      });
    }

    const [recentRes, savedRes, popularRes, promosRes, nearbyRes] = results as unknown as [
      PromiseSettledResult<PlaceItem[]>,
      PromiseSettledResult<SavedPlace[]>,
      PromiseSettledResult<PopularPlacesResponse>,
      PromiseSettledResult<Promo[]>,
      PromiseSettledResult<PlaceItem[]>,
    ];

    const allFailed = results.every((r) => r.status === 'rejected');

    const next: Partial<PlacesState> = { loading: false };
    // A total failure must not start the 60 s cache window.
    if (!allFailed) next.lastFetchedAt = Date.now();

    if (recentRes.status === 'fulfilled') next.recent = recentRes.value;
    if (savedRes.status === 'fulfilled') next.saved = savedRes.value;
    if (popularRes.status === 'fulfilled') {
      next.quickPicks = popularRes.value.quickPicks;
      next.popular = popularRes.value.popular;
      next.cityHighlights = popularRes.value.cityHighlights;
    }
    if (promosRes.status === 'fulfilled') next.promos = promosRes.value;
    if (nearbyRes.status === 'fulfilled') next.nearby = nearbyRes.value;

    if (allFailed) {
      // Both attempts failed for every request: show the manual retry row.
      next.error = "Couldn't load suggestions.";
    } else if (coords) {
      // Remember WHERE these suggestions are for, so the home screen only
      // re-fetches once the rider has actually moved.
      next.suggestionsCoords = coords;
    }

    set(next);
  },

  toggleSaved: async (place) => {
    const { recent, saved } = get();

    // Find existing saved entry for this place by geoKey approximation
    const geoKey = `${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
    const existingSaved = saved.find(
      (s) => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}` === geoKey,
    );

    if (existingSaved) {
      // Optimistic removal
      set({ saved: saved.filter((s) => s.id !== existingSaved.id) });
      // Update recent to reflect unsaved state
      set((state) => ({
        recent: state.recent.map((r) =>
          r.id === place.id ? { ...r, saved: false, savedId: null } : r,
        ),
      }));
      try {
        await placesApi.deleteSaved(existingSaved.id);
      } catch {
        // Rollback
        set((state) => ({
          saved: [...state.saved, existingSaved],
          recent: state.recent.map((r) =>
            r.id === place.id ? { ...r, saved: true, savedId: existingSaved.id } : r,
          ),
        }));
      }
    } else {
      // Optimistic addition
      const optimistic: SavedPlace = {
        id: `optimistic-${Date.now()}`,
        label: null,
        title: place.title,
        address: place.subtitle,
        lat: place.lat,
        lng: place.lng,
      };
      set({
        saved: [optimistic, ...saved],
        recent: recent.map((r) =>
          r.id === place.id ? { ...r, saved: true, savedId: optimistic.id } : r,
        ),
      });
      try {
        const created = await placesApi.upsertSaved({
          title: place.title,
          address: place.subtitle,
          lat: place.lat,
          lng: place.lng,
        });
        // Replace optimistic entry with real one
        set((state) => ({
          saved: state.saved.map((s) => (s.id === optimistic.id ? created : s)),
          recent: state.recent.map((r) =>
            r.id === place.id ? { ...r, saved: true, savedId: created.id } : r,
          ),
        }));
      } catch {
        // Rollback
        set((state) => ({
          saved: state.saved.filter((s) => s.id !== optimistic.id),
          recent: state.recent.map((r) =>
            r.id === place.id ? { ...r, saved: false, savedId: null } : r,
          ),
        }));
      }
    }
  },

  setHomeWork: async (label, place) => {
    try {
      const created = await placesApi.upsertSaved({
        title: place.title,
        address: place.subtitle,
        lat: place.lat,
        lng: place.lng,
        label,
      });
      set((state) => {
        // Remove any previous entry with this label
        const filtered = state.saved.filter((s) => s.label !== label);
        return { saved: [created, ...filtered] };
      });
    } catch {
      // Silently fail; the user can retry
    }
  },
}));
