/**
 * PlaceImage — RN Image with loading skeleton + graceful MapPin fallback.
 * Never crashes on a missing or broken URL.
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

export const PlaceImage: React.FC<Props> = memo(({ uri, width, height, borderRadius = 0 }) => {
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Recycled cards (FlatList) must not keep a previous image's state.
  useEffect(() => {
    setLoadError(false);
    setLoaded(false);
  }, [uri]);

  const showFallback = !uri || loadError;

  return (
    <View
      style={[
        styles.container,
        { width: width as number, height, borderRadius },
        !loaded && !showFallback && styles.skeleton,
        showFallback && styles.fallback,
      ]}
    >
      {!showFallback && (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={() => setLoadError(true)}
        />
      )}
      {showFallback && (
        <MapPin size={22} color={colors.textMuted} />
      )}
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
