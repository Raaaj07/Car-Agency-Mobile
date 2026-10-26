/**
 * PlaceImage — RN Image with loading skeleton + graceful MapPin fallback.
 * Never crashes on a missing or broken URL. Retries once on failure (the
 * backend photo proxy may still be warming its cache on the first request).
 * Pass-4 (task 10): when the URL points at our own API (the backend photo
 * proxy), the current access token rides along as an Authorization header so
 * the proxy can require auth (REQUIRE_AUTH_FOR_PHOTOS). Third-party hosts
 * never receive the token.
 */
import React, { memo, useEffect, useState } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { API_URL } from '../../api/client';
import { tokenManager } from '../../lib/tokenManager';
import { colors } from '../../theme/theme';

interface Props {
  uri: string | null | undefined;
  width: number | string;
  height: number;
  borderRadius?: number;
  /**
   * Called once the image has failed for good (after the retry). Photo cards
   * use it to remove themselves instead of showing a blank placeholder.
   */
  onFail?: () => void;
}

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1500;

// Pass-4 (task 10): the backend photo proxy may require a bearer token
// (REQUIRE_AUTH_FOR_PHOTOS). RN <Image> cannot use the axios interceptor, so
// we attach the header ourselves — but ONLY to our own API origin; a token
// must never be sent to a third-party host.
const isOwnApiUrl = (value: string) => value.startsWith(API_URL);

export const PlaceImage: React.FC<Props> = memo(({ uri, width, height, borderRadius = 0, onFail }) => {
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Recycled cards (FlatList) must not keep a previous image's state.
  useEffect(() => {
    setLoadError(false);
    setLoaded(false);
    setAttempt(0);
  }, [uri]);

  const showFallback = !uri || loadError;

  // Cache-bust only on retry so a cached failure is not reused.
  const finalUri =
    uri && attempt > 0 ? `${uri}${uri.includes('?') ? '&' : '?'}r=${attempt}` : uri;

  // Computed every render (deliberately not memoized): a retry after a token
  // refresh must pick up the fresh token. No token → no header (the proxy is
  // public by default).
  const token = finalUri && isOwnApiUrl(finalUri) ? tokenManager.getAccessToken() : null;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const handleError = (e: { nativeEvent?: { error?: string } }) => {
    if (__DEV__) {
      // SEC-10: strip the query string — a thumb URL can carry the Mapbox
      // access token, which must never reach logcat/release logs.
      const safeUri = finalUri ? finalUri.split('?')[0] : null;
      console.warn('[PlaceImage] failed to load', safeUri, e?.nativeEvent?.error ?? '');
    }
    if (attempt < MAX_RETRIES) {
      setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAY_MS);
    } else {
      setLoadError(true);
      onFail?.();
    }
  };

  return (
    <View
      style={[
        styles.container,
        { width: width as number, height, borderRadius },
        !loaded && !showFallback && styles.skeleton,
        showFallback && styles.fallback,
      ]}
    >
      {!showFallback && finalUri && (
        <Image
          key={finalUri}
          source={headers ? { uri: finalUri, headers } : { uri: finalUri }}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={handleError}
        />
      )}
      {showFallback && <MapPin size={22} color={colors.textMuted} />}
    </View>
  );
});

PlaceImage.displayName = 'PlaceImage';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  skeleton: {
    backgroundColor: '#EEF2F7',
  },
  fallback: {
    backgroundColor: colors.accentLight,
  },
});