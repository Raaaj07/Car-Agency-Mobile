import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Mapbox, { Camera, MapView, PointAnnotation, ShapeSource, LineLayer } from '@rnmapbox/maps';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

export interface LatLng {
  lat: number;
  lng: number;
}

interface Props {
  mode: 'picker' | 'tracking' | 'navigation';
  pickup?: LatLng;
  dropoff?: LatLng;
  driverPosition?: LatLng; // live position for tracking/navigation modes
  route?: [number, number][]; // [lng, lat] pairs from getRoute(), drawn as a road-following line
  nearbyDrivers?: LatLng[]; // other online/available drivers around pickup — shown as small dots
  onMapPress?: (coords: LatLng) => void; // picker mode: tap to set a point
  darkTheme?: boolean;
  // false = static, non-interactive map (home screen renders it behind the
  // scrolling sheet, where map pan/pinch would fight the scroll gesture).
  interactive?: boolean;
  // picker mode: fades the pickup pin out (home hides it while the sheet
  // takes over the "current location" label).
  pickupVisible?: boolean;
  // picker mode: smooth fly-to target. The home sheet sets this when it is
  // half-scrolled so the current location lands centred in the strip of map
  // still visible above the sheet (bottomPadding = hidden area). Null/absent
  // falls back to centring the pickup.
  flyTo?: { lat: number; lng: number; zoom?: number; bottomPadding?: number } | null;
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
}) => {
  const cameraRef = useRef<Camera>(null);
  const isMountedRef = useRef(true);
  const [pickupOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Smooth pin fade for the home sheet's hand-off to the pickup-point pill.
  useEffect(() => {
    Animated.timing(pickupOpacity, {
      toValue: pickupVisible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [pickupVisible, pickupOpacity]);

  useEffect(() => {
    if ((mode === 'tracking' || mode === 'navigation') && driverPosition && cameraRef.current && isMountedRef.current) {
      try {
        cameraRef.current.setCamera({
          centerCoordinate: [driverPosition.lng, driverPosition.lat],
          zoomLevel: 15,
          animationDuration: 800,
        });
      } catch {
        // Native view was already torn down mid-transition — safe to ignore.
      }
    }
  }, [driverPosition, mode]);

  useEffect(() => {
    if (mode === 'picker' && pickup && dropoff && cameraRef.current && isMountedRef.current) {
      try {
        const lats = [pickup.lat, dropoff.lat];
        const lngs = [pickup.lng, dropoff.lng];
        cameraRef.current.fitBounds(
          [Math.max(...lngs), Math.max(...lats)],
          [Math.min(...lngs), Math.min(...lats)],
          [80, 60, 80, 60],
          800,
        );
      } catch {
        // Same as above.
      }
    }
  }, [mode, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // Smooth camera focus (picker, pickup only — never fights fitBounds):
  // `flyTo` takes priority (home sheet at half-scroll — centers the current
  // location inside the still-visible map strip via bottom padding), and
  // otherwise the pickup is centered with a gentle fly as coords arrive
  // (the initial Camera mount may have happened before coords were known).
  useEffect(() => {
    if (mode !== 'picker' || !cameraRef.current || !isMountedRef.current) return;
    const target =
      flyTo ?? (pickup && !dropoff ? { lat: pickup.lat, lng: pickup.lng, zoom: 14, bottomPadding: 0 } : null);
    if (!target) return;
    try {
      cameraRef.current.setCamera({
        centerCoordinate: [target.lng, target.lat],
        zoomLevel: target.zoom ?? 14,
        padding: {
          paddingLeft: 0,
          paddingRight: 0,
          paddingTop: 0,
          paddingBottom: target.bottomPadding ?? 0,
        },
        animationDuration: 600,
      });
    } catch {
      // Native view was already torn down mid-transition — safe to ignore.
    }
  }, [mode, flyTo, pickup?.lat, pickup?.lng, dropoff]);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        styleURL={darkTheme ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Street}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        pitchEnabled={interactive}
        rotateEnabled={interactive}
        onPress={(e) => {
          if (mode === 'picker' && onMapPress && e.geometry?.coordinates) {
            const [lng, lat] = e.geometry.coordinates;
            onMapPress({ lat, lng });
          }
        }}
      >
        <Camera
          ref={cameraRef}
          zoomLevel={14}
          centerCoordinate={pickup ? [pickup.lng, pickup.lat] : [78.146, 11.6643]}
        />

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

        {nearbyDrivers?.map((d, index) => (
          <PointAnnotation key={`nearby-${index}`} id={`nearby-${index}`} coordinate={[d.lng, d.lat]}>
            <View style={[styles.pin, styles.nearbyPin]} />
          </PointAnnotation>
        ))}

        {pickup && (
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
  container: { flex: 1 },
  map: { flex: 1 },
  pin: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#FFF' },
  pickupPin: { backgroundColor: '#22C55E' },
  nearbyPin: { width: 12, height: 12, backgroundColor: '#3B82F6' },
});