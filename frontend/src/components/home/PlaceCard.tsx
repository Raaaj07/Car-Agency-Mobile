/**
 * PlaceCard — the photo card used for every place suggestion on the rider home
 * screen (Near You, Popular, Explore your city).
 *
 * Styled like Rapido's "suggested destinations": the place photo fills the
 * whole card, a dark gradient at the bottom carries the name, a white chip
 * shows how far it is, a small rating chip sits top-right, and an accent
 * "go" button invites the tap.
 *
 * A place card only exists WITH a photo: if the image fails to load for good
 * the card reports it to the store, and the home lists drop the place (see
 * useVisiblePlaces). Callers must only render places that have an imageUrl.
 */
import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUpRight, MapPin, Star } from 'lucide-react-native';
import { colors, shadows } from '../../theme/theme';
import { PlaceImage } from './PlaceImage';
import { PlaceItem } from '../../api/places';
import { formatDistance } from '../../utils/distance';
import { usePlacesStore } from '../../store/placesStore';

export type PlaceCardVariant = 'tall' | 'wide';

interface Props {
  place: PlaceItem;
  onPress: (place: PlaceItem) => void;
  /** `tall` = portrait card for Near You / Popular, `wide` = landscape card for Explore. */
  variant?: PlaceCardVariant;
  width?: number;
}

export const PLACE_CARD_SIZES: Record<PlaceCardVariant, { width: number; height: number }> = {
  tall: { width: 158, height: 200 },
  wide: { width: 244, height: 144 },
};

/** Wikipedia/Google subtitles can be long addresses — keep a short, readable line. */
function shortSubtitle(subtitle: string | undefined): string | null {
  const text = (subtitle ?? '').trim();
  if (!text) return null;
  return text.length > 44 ? `${text.slice(0, 43).trimEnd()}…` : text;
}

export const PlaceCard: React.FC<Props> = memo(({ place, onPress, variant = 'tall', width }) => {
  const markImageBroken = usePlacesStore((state) => state.markImageBroken);
  const size = PLACE_CARD_SIZES[variant];
  const cardWidth = width ?? size.width;
  const wide = variant === 'wide';

  const distance = formatDistance(place.distanceKm);
  const rating = place.rating ? place.rating.toFixed(1) : null;
  const subtitle = wide ? shortSubtitle(place.subtitle) : null;

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth, height: size.height }]}
      onPress={() => onPress(place)}
      activeOpacity={0.92}
      accessibilityRole="button"
      accessibilityLabel={`Go to ${place.title}${distance ? `, ${distance} away` : ''}`}
    >
      <PlaceImage
        uri={place.imageUrl}
        width={cardWidth}
        height={size.height}
        onFail={() => markImageBroken(place.id)}
      />

      {/* Bottom scrim: keeps the white title readable on any photo. */}
      <LinearGradient
        colors={['rgba(14,10,40,0)', 'rgba(14,10,40,0.35)', 'rgba(14,10,40,0.9)']}
        locations={[0, 0.4, 1]}
        style={[styles.scrim, { height: wide ? 96 : 112 }]}
      />

      {distance ? (
        <View style={styles.distanceChip}>
          <MapPin size={11} color={colors.primary} />
          <Text style={styles.distanceText}>{distance}</Text>
        </View>
      ) : null}

      {rating ? (
        <View style={styles.ratingChip}>
          <Star size={11} color={colors.accent} fill={colors.accent} />
          <Text style={styles.ratingText}>{rating}</Text>
        </View>
      ) : null}

      <View style={styles.caption}>
        <View style={styles.captionText}>
          <Text style={[styles.title, wide && styles.titleWide]} numberOfLines={2}>
            {place.title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.goChip}>
          <ArrowUpRight size={16} color="#FFFFFF" strokeWidth={2.5} />
        </View>
      </View>
    </TouchableOpacity>
  );
});

PlaceCard.displayName = 'PlaceCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#E8EBF2',
    ...shadows.card,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  distanceChip: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  distanceText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  ratingChip: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(14,10,40,0.62)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  caption: {
    position: 'absolute',
    left: 12,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  captionText: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 19,
    color: '#FFFFFF',
  },
  titleWide: {
    fontSize: 16,
    lineHeight: 20,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  goChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
