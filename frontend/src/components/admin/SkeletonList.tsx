import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { colors, radii } from '../../theme/theme';

interface SkeletonListProps {
  count?: number;
  /** Row height hint; last row shrinks to fill remaining space naturally. */
  rowHeight?: number;
  style?: ViewStyle;
}

/**
 * Pulsing placeholder rows for first-load skeletons (spec §3.3) — no extra
 * libraries, one shared Animated loop for every row.
 */
export const SkeletonList: React.FC<SkeletonListProps> = ({
  count = 5,
  rowHeight = 116,
  style,
}) => {
  const [pulse] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={[styles.list, style]} accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Animated.View
          key={i}
          style={[styles.row, { height: rowHeight, opacity: pulse }]}
        >
          <View style={styles.circle} />
          <View style={styles.lines}>
            <View style={[styles.line, { width: '55%' }]} />
            <View style={[styles.line, { width: '80%' }]} />
            <View style={[styles.line, { width: '40%' }]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: 14,
    marginBottom: 10,
  },
  circle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.borderLight,
  },
  lines: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
    gap: 8,
  },
  line: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.borderLight,
  },
});
