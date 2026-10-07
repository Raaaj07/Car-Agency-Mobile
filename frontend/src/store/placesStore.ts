/**
 * placesStore – Zustand store for home-screen place data.
 *
 * fetchAll() runs 5 requests with Promise.allSettled so one failure does not
 * blank all sections. Results are cached for 60 s (skip re-fetch unless forced).
 *
 * toggleSaved() does an optimistic update and rolls back on API failure.
 */
import { create } from 'zustand';
import { placesApi, PlaceItem, SavedPlace } from '../api/places';
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

    const [recentRes, savedRes, popularRes, promosRes, nearbyRes] = await Promise.allSettled([
      placesApi.getRecent(5),
      placesApi.getSaved(),
      placesApi.getPopular(coords),
      promosApi.getActive(),
      coords ? placesApi.getNearby(coords) : Promise.resolve([] as PlaceItem[]),
    ]);

    const next: Partial<PlacesState> = {
      loading: false,
      lastFetchedAt: Date.now(),
    };

    if (recentRes.status === 'fulfilled') next.recent = recentRes.value;
    if (savedRes.status === 'fulfilled') next.saved = savedRes.value;
    if (popularRes.status === 'fulfilled') {
      next.quickPicks = popularRes.value.quickPicks;
      next.popular = popularRes.value.popular;
      next.cityHighlights = popularRes.value.cityHighlights;
    }
    if (promosRes.status === 'fulfilled') next.promos = promosRes.value;
    if (nearbyRes.status === 'fulfilled') next.nearby = nearbyRes.value;

    // If all 5 failed, show a generic error.
    const allFailed = [recentRes, savedRes, popularRes, promosRes, nearbyRes].every(
      (r) => r.status === 'rejected',
    );
    if (allFailed) {
      next.error = 'Couldn\'t load suggestions.';
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
