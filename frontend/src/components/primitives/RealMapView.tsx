import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Mapbox, { Camera, MapView, MarkerView, PointAnnotation, ShapeSource, LineLayer } from '@rnmapbox/maps';
import { colors } from '../../theme/theme';
import { CarBubble, TeardropPin, UserPuck } from './MapMarkers';
import { DriverCarMarker } from './DriverCarMarker';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Shape of rnmapbox's location update consumed by the hidden UserLocation
 *  stream (structural subset — assignable from its Location type). */
interface PuckLocationUpdate {
  coords?: {
    latitude?: number;
    longitude?: number;
    heading?: number;
  } | null;
}

interface Props {
  mode: 'picker' | 'tracking' | 'navigation';
  pickup?: LatLng;
  dropoff?: LatLng;
  driverPosition?: LatLng;
  /** Driver's heading in degrees (0 = north, clockwise). Omit to derive it from movement. */
  driverHeading?: number | null;
  route?: [number, number][];
  nearbyDrivers?: LatLng[];
  onMapPress?: (coords: LatLng) => void;
  darkTheme?: boolean;
  interactive?: boolean;
  pickupVisible?: boolean;
  flyTo?: { lat: number; lng: number; zoom?: number; bottomPadding?: number } | null;
  onPickupPointed?: (coords: LatLng, meta?: { isUserInteraction: boolean }) => void;
  pickerPin?: boolean;
  onCenterIdle?: (coords: LatLng, meta?: { isUserInteraction: boolean }) => void;
  // Fires once when a user gesture (pan/zoom) starts moving the camera —
  // lets the screen show "locating" feedback immediately instead of
  // waiting for the idle + reverse-geocode round trip.
  onCenterGestureStart?: () => void;
  bottomPadding?: number;
  showUserLocation?: boolean;
  recenterTo?: { lat: number; lng: number; nonce: number };
  /**
   * Tracking/navigation modes normally lock the camera onto the driver.
   * Set false to instead keep driver + pickup + dropoff (+ route) all in
   * frame — used by the rider's "driver is coming" screen.
   */
  followDriver?: boolean;
}

export const RealMapView: React.FC<Props> = ({
  mode,
  pickup,
  dropoff,
  driverPosition,
  driverHeading,
  route,
  nearbyDrivers,
  onMapPress,
  darkTheme,
  interactive = true,
  pickupVisible = true,
  flyTo = null,
  onPickupPointed,
  pickerPin = false,
  onCenterIdle,
  onCenterGestureStart,
  bottomPadding = 0,
  showUserLocation = false,
  recenterTo,
  followDriver = true,
}) => {
  const cameraRef = useRef<Camera>(null);
  const isMountedRef = useRef(true);
  const [pickupOpacity] = useState(() => new Animated.Value(1));
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const prevRecenterNonceRef = useRef<number | undefined>(undefined);
  // Latest fix from the hidden UserLocation stream, throttled to real
  // movement/turns so the custom puck never re-renders the map needlessly.
  // `heading` is the GPS course (null = unknown); the puck itself prefers the
  // device compass and only falls back to this.
  const [userPuck, setUserPuck] = useState<LatLng & { heading: number | null } | null>(null);
  const puckRawRef = useRef<LatLng & { heading: number | null } | null>(null);
  const puckShownRef = useRef<LatLng & { heading: number | null } | null>(null);

  const handleUserLocationUpdate = useCallback((loc: PuckLocationUpdate) => {
    const c = loc?.coords;
    if (
      !c ||
      typeof c.latitude !== 'number' ||
      typeof c.longitude !== 'number' ||
      !Number.isFinite(c.latitude) ||
      !Number.isFinite(c.longitude)
    ) {
      return;
    }
    const heading =
      typeof c.heading === 'number' && Number.isFinite(c.heading) && c.heading >= 0
        ? c.heading
        : (puckRawRef.current?.heading ?? null);
    const raw = { lat: c.latitude, lng: c.longitude, heading };
    puckRawRef.current = raw;

    const shown = puckShownRef.current;
    if (shown) {
      const dLatM = Math.abs(raw.lat - shown.lat) * 111320;
      const dLngM =
        Math.abs(raw.lng - shown.lng) * 111320 * Math.cos((raw.lat * Math.PI) / 180);
      const moved = Math.hypot(dLatM, dLngM) >= 0.6;
      let turned = 0;
      if (raw.heading !== null && shown.heading !== null) {
        turned = Math.abs(raw.heading - shown.heading) % 360;
        if (turned > 180) turned = 360 - turned;
      } else if (raw.heading !== shown.heading) {
        turned = 360; // course just became known
      }
      if (!moved && turned < 4) return;
    }
    puckShownRef.current = raw;
    setUserPuck(raw);
  }, []);

  const paddingRef = useRef({
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: bottomPadding,
  });

  // Sync paddingRef and update camera when bottomPadding prop changes
  useEffect(() => {
    paddingRef.current.paddingBottom = bottomPadding;
    if (cameraRef.current && mapReady) {
      try {
        cameraRef.current.setCamera({
          padding: paddingRef.current,
          animationDuration: 0,
        });
      } catch {
        // safe ignore
      }
    }
  }, [bottomPadding, mapReady]);

  const [initialCenter] = useState<[number, number]>(
    pickup ? [pickup.lng, pickup.lat] : [78.146, 11.6643],
  );

  const prevPickupKeyRef = useRef<string | null>(null);
  const prevFlyRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastCameraKeyRef = useRef<string | null>(null);
  // Latched by onCameraChanged while a user gesture is active. The
  // idle-time gesture flag is unreliable (false once the gesture ends),
  // so without this latch user pans would never count as interaction and
  // the pickup would never follow the map.
  const userGestureRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    Animated.timing(pickupOpacity, {
      toValue: pickupVisible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [pickupVisible, pickupOpacity]);

  // Tracking / navigation mode camera
  useEffect(() => {
    if ((mode === 'tracking' || mode === 'navigation') && followDriver && driverPosition && cameraRef.current && isMountedRef.current) {
      try {
        cameraRef.current.setCamera({
          centerCoordinate: [driverPosition.lng, driverPosition.lat],
          zoomLevel: 15,
          padding: paddingRef.current,
          animationDuration: 800,
        });
      } catch {
        // safe ignore
      }
    }
  }, [driverPosition, mode, followDriver]);

  // Fit bounds when both pickup & dropoff exist (booking + tracking before
  // live driver position). Includes the full route geometry so curved roads
  // stay on screen. Re-runs when the map becomes ready, when the route
  // arrives, or when the sheet size changes.
  const fitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapReady || !cameraRef.current || !isMountedRef.current) return;
    if (!pickup || !dropoff) return;
    // In live tracking modes the camera follows the driver once a live
    // position exists; only fit endpoints while there is none.
    if ((mode === 'tracking' || mode === 'navigation') && followDriver && driverPosition) return;

    const lats: number[] = [pickup.lat, dropoff.lat];
    const lngs: number[] = [pickup.lng, dropoff.lng];
    if (route && route.length > 0) {
      for (const pt of route) {
        const lng = pt[0];
        const lat = pt[1];
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          lngs.push(lng);
          lats.push(lat);
        }
      }
    }
    if ((mode === 'picker' || !followDriver) && driverPosition) {
      lngs.push(driverPosition.lng);
      lats.push(driverPosition.lat);
    }

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const top = 90;
    const right = 50;
    const left = 50;
    const bottom = 70 + bottomPadding;
    // When the driver is part of the frame (followDriver=false) quantise the
    // key to ~100 m so every small GPS update doesn't re-animate the camera.
    const keyDigits = followDriver ? 5 : 3;
    const key = `${mode}|${minLat.toFixed(keyDigits)},${minLng.toFixed(keyDigits)}|${maxLat.toFixed(keyDigits)},${maxLng.toFixed(keyDigits)}|${top},${right},${bottom},${left}|${route?.length ?? 0}`;
    if (fitKeyRef.current === key) return;
    fitKeyRef.current = key;

    try {
      // Degenerate case: pickup and dropoff (nearly) identical — fitBounds
      // would zoom to max level, so centre on the point instead.
      const span = Math.max(Math.abs(maxLat - minLat), Math.abs(maxLng - minLng));
      if (span < 0.0005) {
        cameraRef.current.setCamera({
          centerCoordinate: [pickup.lng, pickup.lat],
          zoomLevel: 15,
          animationDuration: 700,
        });
      } else {
        cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], [top, right, bottom, left], 700);
      }
    } catch {
      // safe ignore
    }
  }, [mode, mapReady, pickup, dropoff, route, bottomPadding, driverPosition, followDriver]);

  // Picker mode smooth camera focus
  useEffect(() => {
    if (mode !== 'picker' || !mapReady || !cameraRef.current || !isMountedRef.current) return;
    const pickupKey = pickup ? `${pickup.lat},${pickup.lng}` : null;
    const isArrival = pickupKey !== null && prevPickupKeyRef.current === null;
    prevPickupKeyRef.current = pickupKey;
    const hadFly = prevFlyRef.current != null;
    prevFlyRef.current = flyTo;

    const isUnfocusReset = !flyTo && hadFly;
    const target =
      flyTo ??
      ((isArrival || isUnfocusReset) && pickup && !dropoff
        ? { lat: pickup.lat, lng: pickup.lng, zoom: 14 }
        : null);
    if (!target) return;

    const key = `${target.lat},${target.lng}|${target.zoom ?? 14}|${paddingRef.current.paddingBottom}`;
    if (lastCameraKeyRef.current === key) return;
    lastCameraKeyRef.current = key;
    try {
      cameraRef.current.setCamera({
        centerCoordinate: [target.lng, target.lat],
        zoomLevel: target.zoom ?? 14,
        padding: paddingRef.current,
        animationDuration: 600,
      });
    } catch {
      // safe ignore
    }
  }, [mode, mapReady, flyTo, pickup, dropoff]);

  // Imperative camera recenter when recenterTo.nonce changes
  useEffect(() => {
    if (!recenterTo || !cameraRef.current || !isMountedRef.current) return;
    if (prevRecenterNonceRef.current === recenterTo.nonce) return;
    prevRecenterNonceRef.current = recenterTo.nonce;
    try {
      cameraRef.current.setCamera({
        centerCoordinate: [recenterTo.lng, recenterTo.lat],
        zoomLevel: 15.5,
        padding: paddingRef.current,
        animationDuration: 600,
      });
    } catch {
      // safe ignore
    }
  }, [recenterTo]);

  const tokenMissing = !MAPBOX_TOKEN;

  // Nearby drivers (capped) — rendered as car-icon bubbles. Memoised so the
  // puck/camera re-renders don't rebuild the list every time.
  const cappedDrivers = useMemo(() => (nearbyDrivers ?? []).slice(0, 15), [nearbyDrivers]);

  return (
    <View style={styles.container}>
      {tokenMissing && (
        <View style={styles.bannerMissing}>
          <Text style={styles.bannerText}>Map token missing in this build</Text>
        </View>
      )}
      {!!mapError && !tokenMissing && (
        <View style={styles.bannerError}>
          <Text style={styles.bannerText}>Map failed to load: {mapError}</Text>
        </View>
      )}

      <MapView
        style={styles.map}
        styleURL={darkTheme ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Street}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        pitchEnabled={interactive}
        rotateEnabled={interactive}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onMapLoadingError={() => setMapError('Style load error')}
        onMapIdle={(state) => {
          const centre = state?.properties?.center;
          if (Array.isArray(centre) && Number.isFinite(centre[0]) && Number.isFinite(centre[1])) {
            const coords: LatLng = { lng: centre[0], lat: centre[1] };
            const isUserInteraction =
              userGestureRef.current || state?.gestures?.isGestureActive === true;
            userGestureRef.current = false;
            if (onCenterIdle) onCenterIdle(coords, { isUserInteraction });
            if (onPickupPointed) onPickupPointed(coords, { isUserInteraction });
          }
        }}
        onCameraChanged={(state) => {
          // Fires continuously while the camera moves with an accurate
          // gesture flag — latch it for onMapIdle above. Ref-only, no
          // re-render per frame.
          if (state?.gestures?.isGestureActive === true && !userGestureRef.current) {
            userGestureRef.current = true;
            onCenterGestureStart?.();
          }
        }}
        onPress={(e) => {
          if (mode === 'picker' && onMapPress && e.geometry?.coordinates) {
            const [lng, lat] = e.geometry.coordinates;
            onMapPress({ lat, lng });
          }
        }}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter,
            zoomLevel: 14,
          }}
        />

        {/* Drives the location stream only — the visible marker is the custom
            Rapido-style puck below, so the built-in dot stays hidden. */}
        {showUserLocation && (
          <Mapbox.UserLocation visible={false} onUpdate={handleUserLocationUpdate} />
        )}
        {showUserLocation && userPuck && (
          <MarkerView
            coordinate={[userPuck.lng, userPuck.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <UserPuck course={userPuck.heading} />
          </MarkerView>
        )}

        {route && route.length > 1 && (
          <ShapeSource
            id="routeSource"
            shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: route }, properties: {} }}
          >
            <LineLayer
              id="routeLine"
              style={{ lineColor: '#211B4E', lineWidth: 4, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.85 }}
            />
          </ShapeSource>
        )}

        {/* Nearby drivers as little car bubbles (static children — cheap) */}
        {cappedDrivers.map((d, index) => (
          <PointAnnotation
            key={`nearby-driver-${index}`}
            id={`nearby-driver-${index}`}
            coordinate={[d.lng, d.lat]}
          >
            <CarBubble />
          </PointAnnotation>
        ))}

        {pickup && !pickerPin && (
          <MarkerView
            coordinate={[pickup.lng, pickup.lat]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <Animated.View style={[styles.pinWrap, { opacity: pickupOpacity }]}>
              <TeardropPin color="#22C55E" />
            </Animated.View>
          </MarkerView>
        )}
        {dropoff && (
          <MarkerView
            coordinate={[dropoff.lng, dropoff.lat]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <TeardropPin color="#E08A34" />
          </MarkerView>
        )}
        {(mode === 'tracking' || mode === 'navigation') && driverPosition && (
          <DriverCarMarker position={driverPosition} heading={driverHeading} />
        )}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  map: { flex: 1 },
  pinWrap: { alignItems: 'center' },
  bannerMissing: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    zIndex: 999,
    backgroundColor: colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  bannerError: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    zIndex: 999,
    backgroundColor: colors.warning,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  bannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});