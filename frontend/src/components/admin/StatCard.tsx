import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';
import { colors, radii, shadows } from '../../theme/theme';

type StatTone = 'neutral' | 'amber' | 'success' | 'danger' | 'navy';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  tone?: StatTone;
  /** Extra emphasis (e.g. pending applications > 0). */
  highlighted?: boolean;
  /** Tap-through to the filtered list. */
  onPress?: () => void;
  style?: ViewStyle;
}

const TONE_COLORS: Record<StatTone, { tint: string; value: string }> = {
  neutral: { tint: colors.surface, value: colors.primary },
  amber: { tint: colors.accentLight, value: colors.accent },
  success: { tint: colors.successLight, value: colors.success },
  danger: { tint: colors.dangerLight, value: colors.danger },
  navy: { tint: colors.primaryLight, value: colors.textLight },
};

/** Dashboard stat card — value in 22/800 to match DriverDashboard numbers. */
export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  tone = 'neutral',
  highlighted = false,
  onPress,
  style,
}) => {
  const palette = TONE_COLORS[tone];

  const body = (
    <View style={styles.body}>
      {icon ? (
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: tone === 'navy' ? colors.primaryDark : palette.tint },
          ]}
        >
          {icon}
        </View>
      ) : null}
      <Text
        style={[
          styles.value,
          { color: tone === 'navy' ? colors.textLight : colors.textPrimary },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text
        style={[
          styles.label,
          { color: tone === 'navy' ? colors.textLight : colors.textSecondary },
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
      {highlighted ? <View style={styles.dot} /> : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        style={[styles.card, highlighted && styles.cardHighlighted, style]}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, highlighted && styles.cardHighlighted, style]}>{body}</View>;
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardHighlighted: {
    borderColor: colors.accent,
  },
  body: {
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
  dot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
});
