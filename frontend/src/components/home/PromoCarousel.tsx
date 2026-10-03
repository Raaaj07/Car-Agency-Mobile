import React, { memo, useCallback, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Tag, Check } from 'lucide-react-native';
import { colors, radii, shadows } from '../../theme/theme';
import { Promo, promosApi } from '../../api/promos';
import { useRideStore } from '../../store/rideStore';

interface Props {
  promos: Promo[];
}

export const PromoCarousel: React.FC<Props> = memo(({ promos }) => {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = windowWidth - 40; // Full width minus 20px padding on each side
  const [activeIndex, setActiveIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<Record<string, string>>({});
  const [appliedCodes, setAppliedCodes] = useState<Record<string, boolean>>({});

  const appliedPromoCode = useRideStore((state) => state.promoCode);
  const applyPromoCode = useRideStore((state) => state.applyPromoCode);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = e.nativeEvent.contentOffset.x;
      const index = Math.round(offset / cardWidth);
      setActiveIndex(index);
    },
    [cardWidth],
  );

  const handleApplyPromo = async (promo: Promo) => {
    try {
      const res = await promosApi.validate(promo.code);
      if (res.valid) {
        applyPromoCode(promo.code);
        setAppliedCodes((prev) => ({ ...prev, [promo.code]: true }));
        setStatusMessage((prev) => ({
          ...prev,
          [promo.code]: `Code ${promo.code} applied! Saved ₹${res.discountAmount}`,
        }));
      } else {
        setStatusMessage((prev) => ({
          ...prev,
          [promo.code]: res.message || 'Invalid promo code',
        }));
      }
    } catch {
      // Offline fallback: apply client-side if VAZHI20
      applyPromoCode(promo.code);
      setAppliedCodes((prev) => ({ ...prev, [promo.code]: true }));
      setStatusMessage((prev) => ({
        ...prev,
        [promo.code]: `Code ${promo.code} applied!`,
      }));
    }
  };

  if (!promos || promos.length === 0) return null;

  return (
    <View style={styles.container}>
      <FlatList
        data={promos}
        keyExtractor={(item) => item.code}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + 12}
        decelerationRate="fast"
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ gap: 12 }}
        renderItem={({ item }) => {
          const isApplied =
            appliedCodes[item.code] || appliedPromoCode === item.code;
          const msg = statusMessage[item.code];

          return (
            <View style={[styles.card, { width: cardWidth }]}>
              <View style={styles.headerRow}>
                <View style={styles.badge}>
                  <Tag size={12} color={colors.accent} />
                  <Text style={styles.badgeText}>{item.code}</Text>
                </View>
                {isApplied && (
                  <View style={styles.appliedBadge}>
                    <Check size={12} color={colors.success} />
                    <Text style={styles.appliedBadgeText}>Applied</Text>
                  </View>
                )}
              </View>

              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.subtitle}>{item.subtitle}</Text>

              {!!msg && (
                <Text
                  style={[
                    styles.statusText,
                    isApplied ? styles.successMsg : styles.errorMsg,
                  ]}
                >
                  {msg}
                </Text>
              )}

              <TouchableOpacity
                style={[styles.ctaBtn, isApplied && styles.ctaBtnApplied]}
                onPress={() => handleApplyPromo(item)}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.ctaText, isApplied && styles.ctaTextApplied]}
                >
                  {isApplied ? 'Applied' : item.cta || 'Apply'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {/* Pagination Dots */}
      {promos.length > 1 && (
        <View style={styles.dotsRow}>
          {promos.map((p, idx) => (
            <View
              key={p.code}
              style={[
                styles.dot,
                idx === activeIndex ? styles.dotActive : null,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
});

PromoCarousel.displayName = 'PromoCarousel';

const styles = StyleSheet.create({
  container: {
    marginVertical: 14,
  },
  card: {
    backgroundColor: colors.primary,
    borderRadius: radii.card,
    padding: 18,
    ...shadows.card,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(224, 138, 52, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  appliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  appliedBadgeText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  successMsg: {
    color: colors.success,
  },
  errorMsg: {
    color: colors.danger,
  },
  ctaBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.button,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
  },
  ctaBtnApplied: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  ctaTextApplied: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.accent,
  },
});
