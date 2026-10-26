/**
 * useDriverRoute — the road-following route from the driver's live position to
 * a target (pickup while the driver is coming, drop-off during the trip), plus
 * the ETA/distance that come with it.
 *
 * THROTTLE: the driver's GPS fires every few seconds and Mapbox Directions is
 * billed per call, so a new route is requested at most once per
 * MIN_REFETCH_MS (20 s) per mounted screen. Movement alone never buys an
 * earlier call; the 5 s tick simply re-checks the 20 s window (so a slow or
 * stopped driver still gets a fresh ETA) and also retries after a failure.
 * A failure keeps the last good route/ETA on screen.
 */
import { useEffect, useRef, useState } from 'react';
import { getRoute } from '../api/mapbox';

export interface RoutePoint {
  lat: number;
  lng: number;
}

interface Args {
  driverPosition?: RoutePoint;
  target?: RoutePoint;
  /** false pauses fetching (the last route stays on screen); defaults to true. */
  enabled?: boolean;
}

export interface DriverRoute {
  /** [lng, lat] pairs for the map line. */
  route?: [number, number][];
  etaSeconds: number | null;
  distanceMeters: number | null;
}

/** Acceptance: never more than one Directions call per 20 s per screen. */
const MIN_REFETCH_MS = 20_000;
/** How often the 20 s window is re-checked while waiting. */
const REFRESH_TICK_MS = 5_000;
/** A target this far away is a different route (bypasses the throttle once). */
const SAME_TARGET_M = 25;

function metersBetween(a: RoutePoint, b: RoutePoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng);
}

export function useDriverRoute({
  driverPosition,
  target,
  enabled = true,
}: Args): DriverRoute {
  const [state, setState] = useState<DriverRoute>({
    etaSeconds: null,
    distanceMeters: null,
  });

  // Everything the tick needs, kept fresh without re-creating the interval on
  // every GPS fix. Written in an effect (never during render).
  const latestRef = useRef<Args>({ driverPosition, target, enabled });
  useEffect(() => {
    latestRef.current = { driverPosition, target, enabled };
  });

  const requestRef = useRef<() => void>(() => {});
  const lastFetchAtRef = useRef(0);
  const lastTargetRef = useRef<RoutePoint | null>(null);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const maybeFetch = () => {
      const latest = latestRef.current;
      const pos = latest.driverPosition;
      const dest = latest.target;
      if (!latest.enabled || !pos || !dest || inFlightRef.current) return;

      const now = Date.now();
      const lastTarget = lastTargetRef.current;
      const targetChanged = !lastTarget || metersBetween(lastTarget, dest) > SAME_TARGET_M;
      // THROTTLE (acceptance #5) — the one and only Directions call site.
      if (!targetChanged && now - lastFetchAtRef.current < MIN_REFETCH_MS) return;

      inFlightRef.current = true;
      lastFetchAtRef.current = now;
      lastTargetRef.current = dest;
      const requestId = ++requestIdRef.current;

      getRoute(pos, dest)
        .then((result) => {
          // Keep-last-on-failure: a null result leaves the previous route up.
          if (cancelled || requestId !== requestIdRef.current || !result) return;
          setState({
            route: result.coordinates,
            etaSeconds: result.durationSeconds,
            distanceMeters: result.distanceMeters,
          });
        })
        .catch(() => {
          // Network hiccup — keep the previous route/ETA; the tick retries.
        })
        .finally(() => {
          if (requestId === requestIdRef.current) inFlightRef.current = false;
        });
    };

    requestRef.current = maybeFetch;
    maybeFetch();
    const timer = setInterval(maybeFetch, REFRESH_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      requestRef.current = () => {};
      // Invalidate a response still in flight and free the slot so a remount
      // (or StrictMode double-mount) doesn't have to wait for it.
      requestIdRef.current += 1;
      inFlightRef.current = false;
    };
  }, []);

  // A new GPS fix may unblock the very first request (the driver often
  // appears a moment after mount). Still gated by the 20 s window above.
  useEffect(() => {
    requestRef.current();
  }, [driverPosition, target, enabled]);

  return state;
}
