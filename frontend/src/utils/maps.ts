import { Linking, Platform, Alert } from 'react-native';

export interface MapCoordinates {
  lat: number;
  lng: number;
  address?: string;
}

/**
 * Opens Google Maps (native app or browser fallback) for turn-by-turn driving navigation
 * to the specified destination coordinates.
 *
 * Supports:
 * - Android native intent (google.navigation:q=lat,lng&mode=d)
 * - iOS Google Maps app (comgooglemaps://) or Apple Maps fallback
 * - Universal web Google Maps (https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=driving)
 */
export async function openGoogleMapsNavigation(
  destination: MapCoordinates,
  origin?: { lat: number; lng: number }
): Promise<void> {
  const { lat, lng, address } = destination;
  const label = encodeURIComponent(address || 'Destination');

  // Universal Google Maps directions URL (works everywhere: browser, iOS, Android)
  const originParam = origin ? `&origin=${origin.lat},${origin.lng}` : '';
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${originParam}&travelmode=driving`;

  // Native app URIs
  const androidIntentUrl = `google.navigation:q=${lat},${lng}&mode=d`;
  const iosGmapsUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
  const iosAppleMapsUrl = `maps:0,0?q=${label}@${lat},${lng}`;

  try {
    if (Platform.OS === 'android') {
      const canOpen = await Linking.canOpenURL(androidIntentUrl).catch(() => false);
      if (canOpen) {
        await Linking.openURL(androidIntentUrl);
        return;
      }
    } else if (Platform.OS === 'ios') {
      const canOpenGmaps = await Linking.canOpenURL(iosGmapsUrl).catch(() => false);
      if (canOpenGmaps) {
        await Linking.openURL(iosGmapsUrl);
        return;
      }
      const canOpenApple = await Linking.canOpenURL(iosAppleMapsUrl).catch(() => false);
      if (canOpenApple) {
        await Linking.openURL(iosAppleMapsUrl);
        return;
      }
    }

    // Default universal URL opens Google Maps in app or web browser
    await Linking.openURL(webUrl);
  } catch (error) {
    try {
      await Linking.openURL(webUrl);
    } catch {
      Alert.alert(
        'Navigation Error',
        'Unable to open Google Maps navigation. Please ensure Google Maps or a web browser is installed.'
      );
    }
  }
}
