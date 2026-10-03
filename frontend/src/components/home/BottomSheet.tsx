/**
 * BottomSheet — custom 3-snap bottom sheet built with RN Animated + PanResponder.
 * No Reanimated or @gorhom/bottom-sheet native dependencies.
 *
 * Stale closure fix: snapRef and snapYRef store latest values.
 * Clamping: translateY is clamped between expandedY and collapsedY during pan.
 * Gesture gating: content drag moves sheet when collapsed/default, or when expanded with scrollY <= 0.
 * Android BackHandler: collapses expanded -> default when hardware back button is pressed.
 */
import React, {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  BackHandler,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { shadows } from '../../theme/theme';

export type SnapPoint = 'collapsed' | 'default' | 'expanded';

export interface SnapPointsConfig {
  expanded: number;  // translateY at top (e.g. insets.top + 56)
  default: number;   // translateY at middle
  collapsed: number; // translateY at bottom
}

interface Props {
  snapY: SnapPointsConfig;
  initialSnap?: SnapPoint;
  onSnapChange?: (snap: SnapPoint) => void;
  header: React.ReactNode;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<Props> = memo(({
  snapY,
  initialSnap = 'default',
  onSnapChange,
  header,
  children,
}) => {
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>(initialSnap);

  // Stale closure refs
  const snapRef = useRef<SnapPoint>(initialSnap);
  const snapYRef = useRef<SnapPointsConfig>(snapY);
  const scrollYRef = useRef<number>(0);

  // Sync refs on render
  snapRef.current = currentSnap;
  snapYRef.current = snapY;

  const translateY = useRef(new Animated.Value(snapY[initialSnap])).current;

  // Clamp helper
  const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

  const animateTo = useCallback(
    (target: SnapPoint, velocity = 0) => {
      snapRef.current = target;
      setCurrentSnap(target);
      onSnapChange?.(target);
      const toValue = snapYRef.current[target];

      Animated.spring(translateY, {
        toValue,
        velocity,
        tension: 68,
        friction: 11,
        useNativeDriver: true,
      }).start();
    },
    [onSnapChange, translateY],
  );

  // Handle snapY prop changes
  useEffect(() => {
    const targetY = snapY[snapRef.current];
    Animated.timing(translateY, {
      toValue: targetY,
      duration: 0,
      useNativeDriver: true,
    }).start();
  }, [snapY, translateY]);

  // Android hardware back button handler
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (snapRef.current === 'expanded') {
          animateTo('default');
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [animateTo]),
  );

  // Unified PanResponder attached to header and sheet container
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => {
        const isExp = snapRef.current === 'expanded';
        // If expanded and scrolled down inside content, let ScrollView handle it
        if (isExp && scrollYRef.current > 0) return false;
        // If expanded, scrollY is 0, and user is pulling DOWN, intercept to drag sheet down
        if (isExp && scrollYRef.current <= 0 && gs.dy > 5) return true;
        // If not expanded (collapsed or default), any vertical move drags sheet
        if (!isExp && Math.abs(gs.dy) > 5) return true;
        return Math.abs(gs.dy) > 8;
      },
      onPanResponderGrant: () => {
        translateY.stopAnimation();
        (translateY as any).extractOffset();
      },
      onPanResponderMove: (_, gs) => {
        const config = snapYRef.current;
        const currentSnapY = config[snapRef.current];
        const rawY = currentSnapY + gs.dy;
        // Clamp translateY between expanded (top) and collapsed (bottom)
        const clampedY = clamp(rawY, config.expanded, config.collapsed);
        translateY.setValue(clampedY - currentSnapY);
      },
      onPanResponderRelease: (_, gs) => {
        (translateY as any).flattenOffset();
        const config = snapYRef.current;
        const currentY = config[snapRef.current] + gs.dy;
        const vy = gs.vy;

        let target: SnapPoint = 'default';
        if (vy < -0.4) {
          target = snapRef.current === 'collapsed' ? 'default' : 'expanded';
        } else if (vy > 0.4) {
          target = snapRef.current === 'expanded' ? 'default' : 'collapsed';
        } else {
          const distExpanded = Math.abs(currentY - config.expanded);
          const distDefault = Math.abs(currentY - config.default);
          const distCollapsed = Math.abs(currentY - config.collapsed);
          const min = Math.min(distExpanded, distDefault, distCollapsed);
          if (min === distExpanded) target = 'expanded';
          else if (min === distDefault) target = 'default';
          else target = 'collapsed';
        }
        animateTo(target, vy * 1000);
      },
      onPanResponderTerminate: (_, gs) => {
        (translateY as any).flattenOffset();
        animateTo(snapRef.current, gs.vy * 1000);
      },
    }),
  ).current;

  const isExpanded = currentSnap === 'expanded';

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          transform: [{ translateY }],
        },
      ]}
    >
      {/* Header Region */}
      <View style={styles.headerArea} {...panResponder.panHandlers}>
        <View style={styles.handle} />
        {header}
      </View>

      {/* Content Area */}
      <View style={styles.contentArea}>
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<any>, {
              scrollEnabled: isExpanded,
              onScroll: (e: any) => {
                const y = e.nativeEvent?.contentOffset?.y ?? 0;
                scrollYRef.current = y;
              },
              scrollEventThrottle: 16,
            })
          : children}
      </View>
    </Animated.View>
  );
});

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    ...shadows.modal,
    zIndex: 20,
  },
  headerArea: {
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E6EE',
    alignSelf: 'center',
    marginBottom: 10,
  },
  contentArea: {
    flex: 1,
  },
});
