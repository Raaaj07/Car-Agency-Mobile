import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Home, Briefcase, MapPin } from 'lucide-react-native';
import { colors, radii, shadows } from '../../theme/theme';
import { PlaceImage } from './PlaceImage';
import { PlaceItem } from '../../api/places';

interface QuickPickTileProps {
  type: 'place' | 'home' | 'work' | 'search_more';
  place?: PlaceItem;
  label?: string;
  subtitle?: string;
  onPress: () => void;
  tileWidth: number;
}

export const QuickPickTile: React.FC<QuickPickTileProps> = memo(
  ({ type, place, label, subtitle, onPress, tileWidth }) => {
    if (type === 'home' || type === 'work') {
      const isHome = type === 'home';
      return (
        <TouchableOpacity
          style={[styles.tile, { width: tileWidth }]}
          onPress={onPress}
          activeOpacity={0.85}
        >
          <View
            style={[
              styles.iconBox,
              { backgroundColor: isHome ? '#EEF2FF' : colors.accentLight },
            ]}
          >
            {isHome ? (
              <Home size={24} color={colors.primary} />
            ) : (
              <Briefcase size={24} color={colors.accent} />
            )}
          </View>
          <Text style={styles.tileLabel} numberOfLines={2}>
            {label || (isHome ? 'Home' : 'Work')}
          </Text>
        </TouchableOpacity>
      );
    }

    if (type === 'search_more') {
      return (
        <TouchableOpacity
          style={[styles.tile, { width: tileWidth }]}
          onPress={onPress}
          activeOpacity={0.85}
        >
          <View style={[styles.iconBox, styles.searchBox]}>
            <MapPin size={24} color={colors.primary} />
          </View>
          <Text style={styles.tileLabel} numberOfLines={2}>
            Search for other places
          </Text>
        </TouchableOpacity>
      );
    }

    // Default 'place' tile
    return (
      <TouchableOpacity
        style={[styles.tile, { width: tileWidth }]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <PlaceImage
          uri={place?.imageUrl}
          width="100%"
          height={64}
          borderRadius={12}
        />
        <Text style={styles.tileLabel} numberOfLines={2}>
          {place?.title || label}
        </Text>
      </TouchableOpacity>
    );
  },
);

QuickPickTile.displayName = 'QuickPickTile';

const styles = StyleSheet.create({
  tile: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: 8,
    ...shadows.card,
  },
  iconBox: {
    width: '100%',
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  searchBox: {
    backgroundColor: '#EEF2FF',
  },
  tileLabel: {
    paddingHorizontal: 6,
    paddingTop: 6,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 16,
  },
});
