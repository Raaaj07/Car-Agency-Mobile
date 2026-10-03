import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Clock, Heart } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';
import { PlaceItem } from '../../api/places';

interface Props {
  place: PlaceItem;
  onPress: (place: PlaceItem) => void;
  onToggleHeart: (place: PlaceItem) => void;
  isLast?: boolean;
}

export const RecentPlaceRow: React.FC<Props> = memo(({ place, onPress, onToggleHeart, isLast = false }) => {
  const isSaved = !!place.saved;

  return (
    <TouchableOpacity
      style={[styles.row, !isLast && styles.divider]}
      onPress={() => onPress(place)}
      activeOpacity={0.7}
    >
      <View style={styles.iconWrap}>
        <Clock size={20} color={colors.textSecondary} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {place.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {place.subtitle}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.heartBtn}
        onPress={(e) => {
          e.stopPropagation();
          onToggleHeart(place);
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.6}
      >
        <Heart
          size={20}
          color={isSaved ? colors.accent : colors.textMuted}
          fill={isSaved ? colors.accent : 'transparent'}
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

RecentPlaceRow.displayName = 'RecentPlaceRow';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    ...typography.bodyBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.meta,
    fontSize: 12,
    marginTop: 2,
  },
  heartBtn: {
    padding: 4,
  },
});
