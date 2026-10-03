/**
 * PickupPin — fixed map overlay pin for picker mode.
 * Single source of truth: Container is bounded by bottomInset so its center
 * matches the padded map camera center. Pin group measures its height via onLayout
 * and shifts by -height/2 so the stem tip sits EXACTLY on the target point.
 */
import React, { memo, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadows } from '../../theme/theme';

interface Props {
  labelOpacity?: Animated.AnimatedInterpolation<number> | number;
  addressText?: string | null;
  bottomInset?: number;
  showCrosshair?: boolean;
}

export const PickupPin: React.FC<Props> = memo(({
  labelOpacity = 1,
  addressText,
  bottomInset = 0,
  showCrosshair = __DEV__,
}) => {
  const [pinHeight, setPinHeight] = useState<number>(0);

  const handleLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && Math.abs(h - pinHeight) > 1) {
      setPinHeight(h);
    }
  };

  // Shift pin group up by half its height so the stem tip sits at dead center of the container
  const translateY = pinHeight > 0 ? -pinHeight / 2 : 0;

  return (
    <View style={[styles.overlayContainer, { bottom: bottomInset }]} pointerEvents="none">
      {/* __DEV__ Crosshair lines for exact alignment verification */}
      {showCrosshair && (
        <>
          <View style={styles.crosshairH} />
          <View style={styles.crosshairV} />
        </>
      )}

      <View
        style={[styles.pinWrapper, { transform: [{ translateY }] }]}
        onLayout={handleLayout}
      >
        <Animated.View style={[styles.labelPill, { opacity: labelOpacity }]}>
          <Text style={styles.labelText} numberOfLines={1}>
            {addressText || 'Pickup Point'}
          </Text>
        </Animated.View>

        <View style={styles.pinDot}>
          <View style={styles.innerDot} />
        </View>
        <View style={styles.pinStem} />
      </View>
    </View>
  );
});

PickupPin.displayName = 'PickupPin';

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  pinWrapper: {
    alignItems: 'center',
  },
  labelPill: {
    backgroundColor: colors.success,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.pill,
    marginBottom: 6,
    maxWidth: 220,
    ...shadows.card,
  },
  labelText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  pinDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.success,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  innerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  pinStem: {
    width: 3,
    height: 14,
    backgroundColor: colors.success,
    borderRadius: 1.5,
    marginTop: -2,
  },

  // __DEV__ Crosshair styling
  crosshairH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.6)',
  },
  crosshairV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.6)',
  },
});
