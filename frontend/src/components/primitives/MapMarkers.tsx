/**
 * MapMarkers — Google-Maps / Rapido-style map markers shared by RealMapView.
 *
 * - UserPuck:    the rider's "me" marker, modelled on Google Maps' blue dot:
 *                a blue core with a white ring, a soft pulsing accuracy halo
 *                and a translucent heading beam (the "flashlight" cone) that
 *                rotates with the direction the phone is facing. The compass
 *                is preferred; GPS course is the fallback; with neither the
 *                beam is hidden (exactly what Google does).
 * - PinShape:    the teardrop pickup/drop pin (green for pickup) with a white
 *                centre dot. The tip is the bottom-centre of the SVG.
 * - TeardropPin: PinShape sized for PointAnnotation. Anchor it with
 *                { x: 0.5, y: 1 } so the tip sits on the coordinate.
 * - CarTopDown:  top-down car silhouette (front = up) used for the live driver
 *                marker. Rotate it by the driver's heading (see DriverCarMarker).
 * - CarBubble:   the small round car badge used for nearby-driver dots.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Car } from 'lucide-react-native';
import { colors, shadows } from '../../theme/theme';

/** Google Maps "my location" blue. */
const PUCK_BLUE = '#4285F4';

// ── angle helpers ────────────────────────────────────────────────────────────
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;
/** Signed shortest rotation (−180…180) that takes `from` to `to`. */
const angleDiff = (to: number, from: number) => norm360(to - from + 180) - 180;

/**
 * Device compass heading (degrees, 0 = north, clockwise), or null while
 * unavailable. watchHeadingAsync has no built-in throttling and can flood the
 * JS thread, so updates are limited to ~7/s and to changes of 3° or more.
 */
function useCompassHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    let lastAt = 0;
    let lastValue: number | null = null;

    Location.watchHeadingAsync((h) => {
      // trueHeading is -1 when it cannot be computed; magHeading is the fallback.
      const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (!Number.isFinite(value) || value < 0) return;
      const now = Date.now();
      if (now - lastAt < 150) return;
      if (lastValue !== null && Math.abs(angleDiff(value, lastValue)) < 3) return;
      lastAt = now;
      lastValue = value;
      setHeading(value);
    })
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch(() => {
        // No compass / permission — the puck falls back to GPS course.
      });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return heading;
}

/**
 * The rider's own location marker (Google Maps style).
 * `course` is the GPS direction of travel, used only when the compass is
 * unavailable. null = unknown (beam hidden).
 */
export const UserPuck: React.FC<{ course: number | null }> = ({ course }) => {
  const [pulse] = useState(() => new Animated.Value(0));
  const [rotation] = useState(() => new Animated.Value(0));
  const rotationRef = useRef(0); // unwrapped degrees so we never spin the long way round
  const initialisedRef = useRef(false);
  const compass = useCompassHeading();
  const target = compass ?? course;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
        // Snap back at zero opacity so the restart is seamless.
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (target === null) return;
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      rotationRef.current = target;
      rotation.setValue(target);
      return;
    }
    const next = rotationRef.current + angleDiff(target, rotationRef.current);
    rotationRef.current = next;
    Animated.timing(rotation, { toValue: next, duration: 180, useNativeDriver: true }).start();
  }, [target, rotation]);

  const haloStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0] }),
    transform: [
      { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) },
    ],
  };
  const beamStyle = {
    opacity: target === null ? 0 : 1,
    transform: [
      { rotate: rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) },
    ],
  };

  return (
    <View style={styles.puckWrap} pointerEvents="none">
      <Animated.View style={[styles.puckHalo, haloStyle]} />

      {/* Heading beam: a 56° wedge fading out from the dot, pointing "up" at
          0° — the wrapper rotates it to the live heading. */}
      <Animated.View style={[styles.puckBeam, beamStyle]}>
        <Svg width={96} height={96} viewBox="0 0 96 96">
          <Defs>
            <RadialGradient
              id="puckBeamGradient"
              cx="48"
              cy="48"
              r="46"
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={PUCK_BLUE} stopOpacity={0.55} />
              <Stop offset="1" stopColor={PUCK_BLUE} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Path d="M48 48 L26.4 7.4 A46 46 0 0 1 69.6 7.4 Z" fill="url(#puckBeamGradient)" />
        </Svg>
      </Animated.View>

      <View style={styles.puckRing}>
        <View style={styles.puckCore} />
      </View>
    </View>
  );
};

/**
 * Teardrop map pin with a white centre dot. Tip = bottom-centre of the SVG.
 * `scale` 1 renders 30×42.
 */
export const PinShape: React.FC<{ color: string; scale?: number }> = ({ color, scale = 1 }) => (
  <Svg width={30 * scale} height={42 * scale} viewBox="0 0 30 42">
    <Path
      d="M15 40 C15 40 2 25.5 2 15 C2 7.3 7.8 1.5 15 1.5 C22.2 1.5 28 7.3 28 15 C28 25.5 15 40 15 40 Z"
      fill={color}
      stroke="#FFFFFF"
      strokeWidth={2.5}
      strokeLinejoin="round"
    />
    <Circle cx={15} cy={15} r={5.5} fill="#FFFFFF" />
  </Svg>
);

export const TeardropPin: React.FC<{ color: string }> = ({ color }) => <PinShape color={color} />;

/**
 * Top-down car, front pointing up. 40×72 viewBox, rendered 30×54 by default.
 * The white outline keeps it readable on both light and dark map styles.
 */
export const CarTopDown: React.FC<{ width?: number; color?: string }> = ({
  width = 30,
  color = colors.primary,
}) => (
  <Svg width={width} height={(width * 72) / 40} viewBox="0 0 40 72">
    {/* wheels (drawn first so they peek out from under the body) */}
    <Rect x={3} y={13} width={5} height={12} rx={2} fill="#0F172A" />
    <Rect x={32} y={13} width={5} height={12} rx={2} fill="#0F172A" />
    <Rect x={3} y={47} width={5} height={12} rx={2} fill="#0F172A" />
    <Rect x={32} y={47} width={5} height={12} rx={2} fill="#0F172A" />
    {/* body */}
    <Rect x={6} y={3} width={28} height={66} rx={13} fill={color} stroke="#FFFFFF" strokeWidth={2} />
    {/* side mirrors */}
    <Rect x={3.5} y={23} width={4} height={4} rx={1.5} fill={color} />
    <Rect x={32.5} y={23} width={4} height={4} rx={1.5} fill={color} />
    {/* windshield */}
    <Path d="M11 22 L29 22 L27 31 L13 31 Z" fill="#CFE0FF" opacity={0.95} />
    {/* roof */}
    <Rect x={11} y={31} width={18} height={14} rx={3} fill="#3A3585" />
    {/* rear window */}
    <Path d="M13 45 L27 45 L29 52 L11 52 Z" fill="#CFE0FF" opacity={0.8} />
    {/* headlights */}
    <Rect x={10} y={5} width={6} height={3} rx={1.5} fill="#FDE68A" />
    <Rect x={24} y={5} width={6} height={3} rx={1.5} fill="#FDE68A" />
    {/* tail lights */}
    <Rect x={10} y={63} width={6} height={3} rx={1.5} fill="#EF4444" />
    <Rect x={24} y={63} width={6} height={3} rx={1.5} fill="#EF4444" />
  </Svg>
);

export const CarBubble: React.FC<{ variant?: 'nearby' | 'active' }> = ({
  variant = 'nearby',
}) => {
  const active = variant === 'active';
  return (
    <View style={[styles.carBubble, active && styles.carBubbleActive]}>
      <Car
        size={active ? 16 : 14}
        color={active ? '#FFFFFF' : colors.primary}
        strokeWidth={2.4}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // ── "me" puck ───────────────────────────────────────────────────────────
  puckWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckHalo: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: PUCK_BLUE,
  },
  puckBeam: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 96,
    height: 96,
  },
  puckRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  },
  puckCore: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: PUCK_BLUE,
  },

  // ── car bubbles (nearby drivers) ────────────────────────────────────────
  carBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7ECF7',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  carBubbleActive: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    ...shadows.button,
  },
});
