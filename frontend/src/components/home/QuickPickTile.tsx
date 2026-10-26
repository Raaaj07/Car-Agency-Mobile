import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Home, Briefcase, MapPin } from 'lucide-react-native';
import { colors, radii } from '../../theme/theme';
import { PlaceImage } from './PlaceImage';
import { PlaceItem } from '../../api/places';
import { formatDistance } from '../../utils/distance';

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
          height={66}
          borderRadius={10}
        />
        <Text style={styles.tileLabel} numberOfLines={2}>
          {place?.title || label}
        </Text>
        {!!formatDistance(place?.distanceKm) && (
          <Text style={styles.tileMeta} numberOfLines={1}>
            {formatDistance(place?.distanceKm)}
          </Text>
        )}
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
    borderColor: '#E5E9F0',
    overflow: 'hidden',
    alignItems: 'center',
    padding: 4,
    paddingBottom: 8,
  },
  iconBox: {
    width: '100%',
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
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
  tileMeta: {
    paddingTop: 2,
    fontSize: 11,
    color: '#6B7280',
  },
});
