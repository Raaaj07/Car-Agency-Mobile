import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowRight, MapPin } from 'lucide-react-native';
import { colors, radii, shadows } from '../../theme/theme';
import { PlaceImage } from './PlaceImage';
import { PlaceItem } from '../../api/places';
import { formatDistance } from '../../utils/distance';

interface Props {
  place: PlaceItem;
  onPress: (place: PlaceItem) => void;
  cardWidth?: number;
}

export const PopularPlaceCard: React.FC<Props> = memo(({ place, onPress, cardWidth = 160 }) => {
  // "2.3 km" from the rider's current location; null (hidden) when unknown.
  const distance = formatDistance(place.distanceKm);

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }]}
      onPress={() => onPress(place)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Go to ${place.title}${distance ? `, ${distance} away` : ''}`}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          {place.title}
        </Text>
        <View style={styles.arrowChip}>
          <ArrowRight size={14} color="#FFFFFF" />
        </View>
      </View>
      {distance ? (
        <View style={styles.distanceRow}>
          <MapPin size={12} color={colors.textSecondary} />
          <Text style={styles.distanceText} numberOfLines={1}>
            {distance} away
          </Text>
        </View>
      ) : null}
      <PlaceImage uri={place.imageUrl} width="100%" height={100} borderRadius={16} />
    </TouchableOpacity>
  );
});

PopularPlaceCard.displayName = 'PopularPlaceCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    padding: 10,
    gap: 8,
    ...shadows.card,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  arrowChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -4,
  },
  distanceText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
