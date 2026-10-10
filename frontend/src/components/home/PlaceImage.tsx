/**
 * PlaceImage — RN Image with loading skeleton + graceful MapPin fallback.
 * Never crashes on a missing or broken URL. Retries once on failure (the
 * backend photo proxy may still be warming its cache on the first request).
 */
import React, { memo, useEffect, useState } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors } from '../../theme/theme';

interface Props {
  uri: string | null | undefined;
  width: number | string;
  height: number;
  borderRadius?: number;
}

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1500;

export const PlaceImage: React.FC<Props> = memo(({ uri, width, height, borderRadius = 0 }) => {
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
          source={{ uri: finalUri }}
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