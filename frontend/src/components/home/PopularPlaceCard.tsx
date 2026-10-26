import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { PlaceImage } from './PlaceImage';
import { PlaceItem } from '../../api/places';
import { colors } from '../../theme/theme';

interface Props {
  place: PlaceItem;
  onPress: (place: PlaceItem) => void;
  cardWidth: number;
}

const IMAGE_HEIGHT = 86;

/**
 * "Popular Places" card (Rapido style): bold name top-left, yellow circular
 * arrow top-right, landscape photo underneath. A photo that cannot load shows
 * a map-pin placeholder; the card stays so the list is never emptied.
 */
export const PopularPlaceCard: React.FC<Props> = memo(({ place, onPress, cardWidth }) => {
  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }]}
      onPress={() => onPress(place)}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`Go to ${place.title}`}
    >
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={2}>
          {place.title}
        </Text>
        <View style={styles.arrow}>
          <ArrowRight size={13} color="#111827" />
        </View>
      </View>
      <PlaceImage
        uri={place.imageUrl}
        width={cardWidth - 14}
        height={IMAGE_HEIGHT}
        borderRadius={10}
      />
    </TouchableOpacity>
  );
});

PopularPlaceCard.displayName = 'PopularPlaceCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E9F0',
    borderRadius: 14,
    padding: 6,
    gap: 6,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 2,
    minHeight: 32,
  },
  title: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  arrow: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFC928',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
