import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { colors, radii, shadows } from '../../theme/theme';
import { PlaceImage } from './PlaceImage';
import { PlaceItem } from '../../api/places';

interface Props {
  place: PlaceItem;
  onPress: (place: PlaceItem) => void;
  cardWidth?: number;
}

export const PopularPlaceCard: React.FC<Props> = memo(({ place, onPress, cardWidth = 160 }) => {
  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }]}
      onPress={() => onPress(place)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Go to ${place.title}`}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          {place.title}
        </Text>
        <View style={styles.arrowChip}>
          <ArrowRight size={14} color="#FFFFFF" />
        </View>
      </View>
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
});
