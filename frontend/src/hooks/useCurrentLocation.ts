/**
 * useCurrentLocation – fast two-stage GPS hook for the Home screen.
 *
 * Stage 1: getLastKnownPositionAsync  → instant approximate fix
 * Stage 2: getCurrentPositionAsync(Balanced) → accurate fix
 *
 * Re-runs on screen focus (useFocusEffect), not just on mount.
 * Falls back to Salem centre (11.6643, 78.1460) when permission is denied,
 * and exposes a `refresh()` action + an "Enable location" prompt via Linking.
 */
import { useCallback, useRef, useState } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';

const SALEM_CENTRE: Location.LocationObjectCoords = {
  latitude: 11.6643,
  longitude: 78.146,
  altitude: null,
  accuracy: null,
  altitudeAccuracy: null,
  heading: null,
  speed: null,
};

export type LocationStatus = 'loading' | 'granted' | 'denied';

export interface CurrentLocationResult {
  coords: Location.LocationObjectCoords | null;
  status: LocationStatus;
  /** Opens device location settings so the user can grant permission. */
  openSettings: () => void;
  /** Manually re-request location (e.g. after granting permission). */
  refresh: () => void;
}

export function useCurrentLocation(): CurrentLocationResult {
  const [coords, setCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [status, setStatus] = useState<LocationStatus>('loading');
  const fetchingRef = useRef(false);

  const fetchLocation = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setStatus('loading');

    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        setStatus('denied');
        setCoords((prev) => prev ?? SALEM_CENTRE);
        return;
      }

      // Stage 1: instant last-known position
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
        if (last) {
          setCoords(last.coords);
          setStatus('granted');
        }
      } catch {
        // getLastKnownPosition not always available; proceed to stage 2
      }

      // Stage 2: accurate current position with 8s timeout guard
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GPS timeout')), 8_000),
      );

      const current = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        timeoutPromise,
      ]);

      setCoords(current.coords);
      setStatus('granted');
    } catch {
      // Permission denied, GPS timeout, or location service disabled
      setStatus('denied');
      setCoords((prev) => prev ?? SALEM_CENTRE);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  // Re-run whenever the screen gains focus (e.g. returning from Settings).
  useFocusEffect(
    useCallback(() => {
      void fetchLocation();
    }, [fetchLocation]),
  );

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  return { coords, status, openSettings, refresh: fetchLocation };
}
