import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, shadows } from '../../theme/theme';
import { PlaceImage } from './PlaceImage';
import { PlaceItem } from '../../api/places';

interface Props {
  highlight: PlaceItem;
  onPress: (place: PlaceItem) => void;
  cardWidth?: number;
}

export const CityHighlightCard: React.FC<Props> = memo(({ highlight, onPress, cardWidth = 150 }) => {
  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }]}
      onPress={() => onPress(highlight)}
      activeOpacity={0.85}
    >
      <PlaceImage uri={highlight.imageUrl} width="100%" height={110} borderRadius={16} />
      <View style={styles.overlay}>
        <Text style={styles.title} numberOfLines={2}>
          {highlight.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

CityHighlightCard.displayName = 'CityHighlightCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  overlay: {
    padding: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 17,
  },
});
