/**
 * PickupPin — fixed map overlay pin for picker mode (Rapido-style).
 *
 * A green teardrop pin with a white centre dot, a small ground shadow under the
 * tip and a dark tooltip bubble above it. While the map is being dragged
 * (`lifted`) the pin floats up and the shadow shrinks, then settles back down
 * when the map comes to rest.
 *
 * Single source of truth: Container is bounded by bottomInset so its center
 * matches the padded map camera center. Pin group measures its height via onLayout
 * and shifts by -height/2 so the pin TIP sits EXACTLY on the target point.
 * (The shadow is absolutely positioned and the lift is a transform, so neither
 * affects that measurement.)
 */
import React, { memo, useEffect, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadows } from '../../theme/theme';
import { PinShape } from '../primitives/MapMarkers';

interface Props {
  labelOpacity?: Animated.AnimatedInterpolation<number> | number;
  addressText?: string | null;
  bottomInset?: number;
  showCrosshair?: boolean;
  /** True while the map is moving — the pin lifts off the ground. */
  lifted?: boolean;
}

const LIFT_PX = 10;
const PIN_SCALE = 1.2;
// PinShape's tip sits 2 viewBox units above the SVG's bottom edge; compensate so
// the visible tip (not the SVG edge) lands exactly on the map centre.
const TIP_GAP = 2 * PIN_SCALE;

export const PickupPin: React.FC<Props> = memo(({
  labelOpacity = 1,
  addressText,
  bottomInset = 0,
  // Alignment crosshair from development — defaults off so no line ever
  // crosses the map/pin in any build. Pass showCrosshair explicitly to
  // re-enable it while debugging pin alignment.
  showCrosshair = false,
  lifted = false,
}) => {
  const [pinHeight, setPinHeight] = useState<number>(0);
  const [lift] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(lift, {
      toValue: lifted ? 1 : 0,
      friction: 7,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [lifted, lift]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && Math.abs(h - pinHeight) > 1) {
      setPinHeight(h);
    }
  };

  // Shift pin group up by half its height so the pin tip sits at dead center of the container
  const translateY = pinHeight > 0 ? -pinHeight / 2 + TIP_GAP : 0;

  const pinLiftStyle = {
    transform: [
      { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT_PX] }) },
    ],
  };
  const shadowStyle = {
    opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.12] }),
    transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }],
  };

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
        <Animated.View style={[styles.bubbleGroup, { opacity: labelOpacity }, pinLiftStyle]}>
          <View style={styles.bubble}>
            <View style={styles.bubbleDot} />
            <Text style={styles.bubbleText} numberOfLines={1}>
              {addressText || 'Pickup Point'}
            </Text>
          </View>
          <View style={styles.bubbleCaret} />
        </Animated.View>

        <View style={styles.pinBox}>
          {/* Ground shadow — absolutely positioned so it never changes layout. */}
          <Animated.View style={[styles.groundShadow, shadowStyle]} />
          <Animated.View style={pinLiftStyle}>
            <PinShape color={colors.success} scale={PIN_SCALE} />
          </Animated.View>
        </View>
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
  bubbleGroup: {
    alignItems: 'center',
    marginBottom: 2,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.md,
    maxWidth: 230,
    ...shadows.card,
  },
  bubbleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginRight: 7,
  },
  bubbleText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  // Little pointer under the bubble, aiming at the pin.
  bubbleCaret: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#111827',
  },
  pinBox: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  groundShadow: {
    position: 'absolute',
    bottom: -2,
    width: 16,
    height: 6,
    borderRadius: 8,
    backgroundColor: '#000000',
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
