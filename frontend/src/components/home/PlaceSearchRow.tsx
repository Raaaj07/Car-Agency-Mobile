/**
 * PlaceSearchRow — the one place-result row used across the home sheet
 * (recents + live typing suggestions) and the Select Destination screen.
 *
 * Rapido-style: plain grey icon (clock for recents, pin for search results
 * with the distance printed underneath), bold title, muted one-line subtitle,
 * dashed divider and an outline favourite heart. Flat — no card, no tint.
 */
import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Briefcase, Heart, History, Home, MapPin } from 'lucide-react-native';
import { colors } from '../../theme/theme';

export type PlaceRowVariant = 'recent' | 'search' | 'home' | 'work';

interface Props {
  title: string;
  subtitle: string;
  variant?: PlaceRowVariant;
  onPress: () => void;
  /** Renders the favourite heart when provided (recent/home/work rows). */
  onToggleHeart?: () => void;
  heartActive?: boolean;
  isLast?: boolean;
  /** e.g. "2.3 km" — shown under the pin icon on search results. */
  distanceText?: string;
}

const ICON_COLOR = '#6B7280';

export const PlaceSearchRow: React.FC<Props> = memo(
  ({
    title,
    subtitle,
    variant = 'recent',
    onPress,
    onToggleHeart,
    heartActive = false,
    isLast = false,
    distanceText,
  }) => {
    return (
      <TouchableOpacity
        style={[styles.row, !isLast && styles.divider]}
        onPress={onPress}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`Go to ${title}`}
      >
        <View style={styles.iconCol}>
          {variant === 'home' ? (
            <Home size={20} color={ICON_COLOR} />
          ) : variant === 'work' ? (
            <Briefcase size={20} color={ICON_COLOR} />
          ) : variant === 'search' ? (
            <MapPin size={20} color={ICON_COLOR} />
          ) : (
            <History size={20} color={ICON_COLOR} />
          )}
          {!!distanceText && (
            <Text style={styles.distance} numberOfLines={1}>
              {distanceText}
            </Text>
          )}
        </View>

        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        {onToggleHeart && (
          <TouchableOpacity
            style={styles.heartBtn}
            onPress={(e) => {
              e.stopPropagation();
              onToggleHeart();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={heartActive ? `Remove ${title} from favourites` : `Save ${title} to favourites`}
          >
            <Heart
              size={22}
              color={heartActive ? colors.accent : ICON_COLOR}
              fill={heartActive ? colors.accent : 'transparent'}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  },
);

PlaceSearchRow.displayName = 'PlaceSearchRow';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 14,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#D9DEE5',
    borderStyle: 'dashed',
  },
  iconCol: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distance: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '500',
    color: '#6B7280',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12.5,
    color: '#6B7280',
    marginTop: 2,
  },
  heartBtn: {
    padding: 4,
  },
});
