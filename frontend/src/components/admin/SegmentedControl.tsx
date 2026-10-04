import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { colors, radii } from '../../theme/theme';

export interface SegmentedOption {
  key: string;
  label: string;
  /** Count badge (e.g. pending applications). Omit to hide. */
  count?: number;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (key: string) => void;
  style?: ViewStyle;
}

/** Segmented tabs with count badges (spec §3.2 segmented control). */
export const SegmentedControl: React.FC<SegmentedControlProps> = ({
  options,
  value,
  onChange,
  style,
}) => {
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(opt.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              opt.count !== undefined ? `${opt.label}, ${opt.count}` : opt.label
            }
            activeOpacity={0.85}
          >
            <Text
              style={[styles.label, active && styles.labelActive]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
            {opt.count !== undefined ? (
              <View style={[styles.badge, active ? styles.badgeActive : styles.badgeIdle]}>
                <Text style={[styles.badgeText, active && styles.badgeTextActive]}>
                  {opt.count > 99 ? '99+' : opt.count}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.textLight,
  },
  badge: {
    marginLeft: 6,
    minWidth: 22,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIdle: {
    backgroundColor: colors.borderLight,
  },
  badgeActive: {
    backgroundColor: colors.primaryLight,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  badgeTextActive: {
    color: colors.textLight,
  },
});
