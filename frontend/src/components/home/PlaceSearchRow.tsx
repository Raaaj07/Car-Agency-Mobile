/**
 * PlaceSearchRow — the one place-result row used across the home sheet
 * (normal + inline search) and the Select Destination screen.
 *
 * Rapido-style: tinted circular icon, bold title, muted subtitle, hairline
 * divider, optional favourite heart. Flat (no per-row card shadow) so lists
 * read as one clean surface.
 */
import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Briefcase, Clock, Heart, Home, MapPin } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';

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
}

const TINTS: Record<PlaceRowVariant, { bg: string; fg: string }> = {
  recent: { bg: '#EEF2FF', fg: colors.primary },
  search: { bg: colors.dangerLight, fg: colors.danger },
  home: { bg: '#EEF2FF', fg: colors.primary },
  work: { bg: colors.accentLight, fg: colors.accent },
};

export const PlaceSearchRow: React.FC<Props> = memo(
  ({ title, subtitle, variant = 'recent', onPress, onToggleHeart, heartActive = false, isLast = false }) => {
    const tint = TINTS[variant];

    return (
      <TouchableOpacity
        style={[styles.row, !isLast && styles.divider]}
        onPress={onPress}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`Go to ${title}`}
      >
        <View style={[styles.iconWrap, { backgroundColor: tint.bg }]}>
          {variant === 'home' ? (
            <Home size={17} color={tint.fg} />
          ) : variant === 'work' ? (
            <Briefcase size={17} color={tint.fg} />
          ) : variant === 'search' ? (
            <MapPin size={17} color={tint.fg} />
          ) : (
            <Clock size={17} color={tint.fg} />
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
              size={19}
              color={heartActive ? colors.accent : colors.textMuted}
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
    paddingVertical: 11,
    gap: 12,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  heartBtn: {
    padding: 4,
  },
});
