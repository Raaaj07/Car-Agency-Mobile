import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Mapbox, { Camera, MapView, PointAnnotation } from '@rnmapbox/maps';

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
  onMapPress?: (coords: LatLng) => void; // picker mode: tap to set a point
  darkTheme?: boolean;
}

export const RealMapView: React.FC<Props> = ({ mode, pickup, dropoff, driverPosition, onMapPress, darkTheme }) => {
  const cameraRef = useRef<Camera>(null);

  // Keep the camera following the driver in tracking/navigation modes.
  useEffect(() => {
    if ((mode === 'tracking' || mode === 'navigation') && driverPosition && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [driverPosition.lng, driverPosition.lat],
        zoomLevel: 15,
        animationDuration: 800,
      });
    }
  }, [driverPosition, mode]);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        styleURL={darkTheme ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Street}
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
          centerCoordinate={
            pickup ? [pickup.lng, pickup.lat] : [78.146, 11.6643] // Salem, TN fallback
          }
        />

        {pickup && (
          <PointAnnotation id="pickup" coordinate={[pickup.lng, pickup.lat]}>
            <View style={[styles.pin, { backgroundColor: '#22C55E' }]} />
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
});