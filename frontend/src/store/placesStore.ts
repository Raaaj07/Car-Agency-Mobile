/**
 * placesStore – Zustand store for home-screen place data.
 *
 * fetchAll() runs 5 requests with Promise.allSettled so one failure does not
 * blank all sections. Anything that failed is retried ONCE, silently, after a
 * short delay; the "Tap to retry" error only appears if every request still
 * failed. Results are cached for 60 s (skip re-fetch unless forced).
 *
 * toggleSaved() does an optimistic update and rolls back on API failure.
 *
 * Per-user scoping: `recent` is the server list (ride drop-offs for THIS
 * rider), `searchRecents` is the local search history for this session.
 * logout() calls reset() so the next account never sees the previous
 * rider's places (the 60 s TTL + suggestionsCoords skip would otherwise
 * serve user A's lists to user B on the same device).
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { placesApi, PlaceItem, PopularPlacesResponse, SavedPlace } from '../api/places';
import { promosApi, Promo } from '../api/promos';

// ── State ────────────────────────────────────────────────────────────────────

interface PlacesState {
  recent: PlaceItem[];
  /** Local (this-device) destination searches for the signed-in rider. */
  searchRecents: PlaceItem[];
  /** Internal: bumped by reset() so an in-flight fetchAll() from the previous
   *  account is discarded instead of repopulating the store after logout. */
  generation: number;
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
  /** Remember a destination the rider picked (bumps to the top, deduped by geo-key). */
  recordSearch: (place: PlaceItem) => void;
  /** Drop every cached list — called on logout so accounts never share places. */
  reset: () => void;
}

// ── Store ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds
const RETRY_DELAY_MS = 1500; // pause before the single silent retry
const SEARCH_HISTORY_LIMIT = 5;

/** Same rounding the backend uses for its ride-history geo_key dedupe. */
const geoKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

export const usePlacesStore = create<PlacesState>((set, get) => ({
  recent: [],
  searchRecents: [],
  generation: 0,
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

    const generation = get().generation;
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

    // logout() reset the store while these requests were in flight — the
    // response belongs to the previous account, drop it.
    if (get().generation !== generation) return;

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

  recordSearch: (place) => {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    set((state) => {
      const key = geoKey(place.lat, place.lng);
      const withoutDupes = state.searchRecents.filter(
        (r) => geoKey(r.lat, r.lng) !== key,
      );
      return {
        searchRecents: [{ ...place, id: `search-${key}` }, ...withoutDupes].slice(
          0,
          SEARCH_HISTORY_LIMIT,
        ),
      };
    });
  },

  reset: () =>
    set((state) => ({
      recent: [],
      searchRecents: [],
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
      generation: state.generation + 1,
    })),
}));

// ── Merged recents (local searches + server ride history) ─────────────────────

const MERGED_RECENTS_LIMIT = 8;

/**
 * One "recently visited" list for both the home sheet and the destination
 * picker: local searches first (newest), then the server's ride drop-offs,
 * deduped by geo-key. The `saved` heart flag is overlaid from the live
 * `saved` array so optimistic toggles show up on merged rows immediately;
 * when the saved list failed to load (empty) we fall back to the flag the
 * server put on the row itself.
 */
export const mergeRecents = (
  searches: PlaceItem[],
  server: PlaceItem[],
  saved: SavedPlace[],
  limit = MERGED_RECENTS_LIMIT,
): PlaceItem[] => {
  const savedIds = new Map(saved.map((s) => [geoKey(s.lat, s.lng), s.id]));
  const seen = new Set<string>();
  const merged: PlaceItem[] = [];
  for (const place of [...searches, ...server]) {
    const key = geoKey(place.lat, place.lng);
    if (seen.has(key)) continue;
    seen.add(key);
    const savedId = savedIds.get(key) ?? (saved.length > 0 ? null : place.savedId ?? null);
    merged.push({ ...place, saved: savedId !== null, savedId });
    if (merged.length >= limit) break;
  }
  return merged;
};

/** Reactive merged view — the single source of recents for every surface. */
export const useMergedRecents = (limit = MERGED_RECENTS_LIMIT): PlaceItem[] => {
  const searches = usePlacesStore((state) => state.searchRecents);
  const server = usePlacesStore((state) => state.recent);
  const saved = usePlacesStore((state) => state.saved);
  return useMemo(
    () => mergeRecents(searches, server, saved, limit),
    [searches, server, saved, limit],
  );
};
