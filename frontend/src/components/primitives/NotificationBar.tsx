import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { colors, radii, typography, shadows } from '../../theme/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ANIM_DURATION = 240;
const DISMISS_THRESHOLD_X = SCREEN_WIDTH * 0.28;
const DISMISS_THRESHOLD_Y = -60;
const VELOCITY_THRESHOLD = 800;

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** How long the bar stays up before auto-dismissing (ms). Defaults to ~3s. */
  durationMs?: number;
  onDismiss: () => void;
}

/**
 * A top toast/banner: slides + fades in, auto-dismisses upward after
 * `durationMs`, and can be swiped left, right, or up at any time to
 * dismiss early with the same smooth animation.
 */
export const NotificationBar: React.FC<Props> = ({
  visible,
  title,
  subtitle,
  icon,
  durationMs = 3200,
  onDismiss,
}) => {
  const [shouldRender, setShouldRender] = useState(visible);
  const translateY = useRef(new Animated.Value(-140)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const animateOut = (direction: 'up' | 'left' | 'right') => {
    clearTimer();
    const targetX = direction === 'left' ? -SCREEN_WIDTH : direction === 'right' ? SCREEN_WIDTH : 0;
    const targetY = direction === 'up' ? -220 : 0;

    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: ANIM_DURATION, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: targetX, duration: ANIM_DURATION, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: targetY, duration: ANIM_DURATION, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        setShouldRender(false);
        onDismiss();
      }
    });
  };

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      translateY.setValue(-140);
      translateX.setValue(0);
      opacity.setValue(0);

      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();

      clearTimer();
      dismissTimer.current = setTimeout(() => animateOut('up'), durationMs);
    }
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: translateX, translationY: translateY } }],
    { useNativeDriver: true },
  ) as (event: PanGestureHandlerGestureEvent) => void;

  const onHandlerStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.END || event.nativeEvent.state === State.CANCELLED) {
      const { translationX, translationY, velocityX, velocityY } = event.nativeEvent;

      if (translationX > DISMISS_THRESHOLD_X || velocityX > VELOCITY_THRESHOLD) {
        animateOut('right');
        return;
      }
      if (translationX < -DISMISS_THRESHOLD_X || velocityX < -VELOCITY_THRESHOLD) {
        animateOut('left');
        return;
      }
      if (translationY < DISMISS_THRESHOLD_Y || velocityY < -VELOCITY_THRESHOLD) {
        animateOut('up');
        return;
      }

      // Didn't cross a threshold — spring back to resting position.
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
      ]).start();
    }
  };

  if (!shouldRender) return null;

  return (
    <PanGestureHandler
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
      activeOffsetX={[-10, 10]}
      activeOffsetY={[-10, 10]}
    >
      <Animated.View
        pointerEvents="box-none"
        style={[styles.container, { opacity, transform: [{ translateY }, { translateX }] }]}
      >
        <View style={styles.card}>
          {icon && <View style={styles.iconWrap}>{icon}</View>}
          <View style={styles.textWrap}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
          </View>
        </View>
      </Animated.View>
    </PanGestureHandler>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    paddingTop: 54,
    paddingHorizontal: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    padding: 14,
    gap: 12,
    ...shadows.modal,
    borderWidth: 1,
    borderColor: '#EEECF2',
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.successLight,
    alignItems: 'center', justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: { ...typography.bodyBold, fontSize: 14 },
  subtitle: { ...typography.meta, fontSize: 12, marginTop: 2 },
});