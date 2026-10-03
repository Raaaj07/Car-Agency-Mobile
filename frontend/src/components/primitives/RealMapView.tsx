import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Mapbox, { Camera, MapView, PointAnnotation, ShapeSource, LineLayer, CircleLayer } from '@rnmapbox/maps';
import { colors } from '../../theme/theme';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
}

export interface LatLng {
  lat: number;
  lng: number;
}

interface Props {
  mode: 'picker' | 'tracking' | 'navigation';
  pickup?: LatLng;
  dropoff?: LatLng;
  driverPosition?: LatLng;
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
}

export const RealMapView: React.FC<Props> = ({
  mode,
  pickup,
  dropoff,
  driverPosition,
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
}) => {
  const cameraRef = useRef<Camera>(null);
  const isMountedRef = useRef(true);
  const [pickupOpacity] = useState(() => new Animated.Value(1));
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const prevRecenterNonceRef = useRef<number | undefined>(undefined);

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
    if ((mode === 'tracking' || mode === 'navigation') && driverPosition && cameraRef.current && isMountedRef.current) {
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
  }, [driverPosition, mode]);

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
    if ((mode === 'tracking' || mode === 'navigation') && driverPosition) return;

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
    if (mode === 'picker' && driverPosition) {
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
    const key = `${mode}|${minLat.toFixed(5)},${minLng.toFixed(5)}|${maxLat.toFixed(5)},${maxLng.toFixed(5)}|${top},${right},${bottom},${left}|${route?.length ?? 0}`;
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
  }, [mode, mapReady, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, route?.length, bottomPadding, driverPosition?.lat, driverPosition?.lng]);

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
  }, [mode, mapReady, flyTo, pickup?.lat, pickup?.lng, dropoff]);

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

  // Prepare capped nearby driver GeoJSON feature collection for ShapeSource (Part C7)
  const cappedDrivers = (nearbyDrivers || []).slice(0, 15);
  const driversGeoJson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: cappedDrivers.map((d, index) => ({
      type: 'Feature',
      id: `driver-${index}`,
      properties: {},
      geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
    })),
  };

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

        {showUserLocation && <Mapbox.UserLocation visible={true} />}

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

        {/* Nearby drivers as ShapeSource + CircleLayer for performance (Part C7) */}
        {cappedDrivers.length > 0 && (
          <ShapeSource id="nearbyDriversSource" shape={driversGeoJson}>
            <CircleLayer
              id="nearbyDriversCircle"
              style={{
                circleRadius: 6,
                circleColor: '#3B82F6',
                circleStrokeWidth: 2,
                circleStrokeColor: '#FFFFFF',
              }}
            />
          </ShapeSource>
        )}

        {pickup && !pickerPin && (
          <PointAnnotation id="pickup" coordinate={[pickup.lng, pickup.lat]}>
            <Animated.View style={[styles.pin, styles.pickupPin, { opacity: pickupOpacity }]} />
          </PointAnnotation>
        )}
        {dropoff && (
          <PointAnnotation id="dropoff" coordinate={[dropoff.lng, dropoff.lat]}>
            <View style={[styles.pin, { backgroundColor: '#E08A34' }]} />
          </PointAnnotation>
        )}
        {(mode === 'tracking' || mode === 'navigation') && driverPosition && (
          <PointAnnotation id="driver" coordinate={[driverPosition.lng, driverPosition.lat]}>
            <View style={[styles.pin, { backgroundColor: '#211B4E', width: 22, height: 22 }]} />
          </PointAnnotation>
        )}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  map: { flex: 1 },
  pin: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#FFF' },
  pickupPin: { backgroundColor: '#22C55E' },
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