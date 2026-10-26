/**
 * NearbyDriversLayer — the small car badges for nearby (unassigned) drivers.
 *
 * The nearby list is a coordinates-only snapshot that refreshes every few
 * seconds, so drawing it directly makes the cars jump on every poll. This
 * layer keeps one shared animation loop (~10 fps) that glides each car from
 * where it is on screen to its new coordinate, matching every new point to
 * the nearest previous car so the API re-ordering its results doesn't send
 * cars across the map.
 *
 * React state is updated at most ~10 times per second and only for at most
 * 15 markers (one array), and the loop stops as soon as everything settles.
 * No driver identity is involved — coordinates only.
 */
import React, { useEffect, useRef, useState } from 'react';
import { MarkerView } from '@rnmapbox/maps';
import { CarBubble } from './MapMarkers';
import type { LatLng } from './RealMapView';

const MAX_MARKERS = 15;
const FRAME_MS = 100; // ~10 fps
const TAU_MS = 1400; // glide time constant (a snap refreshes every 5 s)
const SETTLE_M = 0.8; // close enough — stop animating
const MAX_MATCH_M = 400; // a bigger jump is a different car, not a drive

interface Pair {
  from: LatLng;
  to: LatLng;
}

function metersBetween(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng);
}

export const NearbyDriversLayer: React.FC<{ drivers?: LatLng[] }> = ({ drivers }) => {
  const [poses, setPoses] = useState<LatLng[]>([]);
  // What is currently on screen; written only from the rAF loop.
  const posesRef = useRef<LatLng[]>([]);
  const pairsRef = useRef<Pair[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const startLoopRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let lastAt = Date.now();

    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastTickRef.current < FRAME_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(1000, now - lastAt);
      lastAt = now;
      lastTickRef.current = now;
      const alpha = 1 - Math.exp(-dt / TAU_MS);

      let moving = false;
      const next = pairsRef.current.map((pair) => {
        if (metersBetween(pair.from, pair.to) < SETTLE_M) {
          return { lat: pair.to.lat, lng: pair.to.lng };
        }
        moving = true;
        pair.from = {
          lat: pair.from.lat + (pair.to.lat - pair.from.lat) * alpha,
          lng: pair.from.lng + (pair.to.lng - pair.from.lng) * alpha,
        };
        return pair.from;
      });

      posesRef.current = next;
      setPoses(next);
      if (moving) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    startLoopRef.current = () => {
      lastAt = Date.now();
      lastTickRef.current = 0;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    };

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // Reconcile every new nearby snapshot (the parent polls every ~5 s).
  useEffect(() => {
    const targets = (drivers ?? []).slice(0, MAX_MARKERS);
    const previous = posesRef.current;
    const used = previous.map(() => false);

    pairsRef.current = targets.map((target) => {
      let bestIndex = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < previous.length; i += 1) {
        if (used[i]) continue;
        const distance = metersBetween(previous[i], target);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0 && bestDistance <= MAX_MATCH_M) {
        used[bestIndex] = true;
        return { from: { ...previous[bestIndex] }, to: { ...target } };
      }
      // New (or teleported) car: appears at its coordinate, no long slide.
      return { from: { ...target }, to: { ...target } };
    });

    startLoopRef.current();
  }, [drivers]);

  if (poses.length === 0) return null;

  // Rendered as an array — the same shape as the inline `.map()` this layer
  // replaced, so @rnmapbox/maps sees plain MarkerView children.
  return poses.map((pose, index) => (
    <MarkerView
      key={`nearby-${index}`}
      coordinate={[pose.lng, pose.lat]}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlap
    >
      <CarBubble />
    </MarkerView>
  ));
};
