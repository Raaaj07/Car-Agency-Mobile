import React from 'react';
import { StyleSheet, ViewStyle, ScrollView } from 'react-native';
import { Pill } from '../primitives/Pill';
import { colors } from '../../theme/theme';

export interface FilterChipOption {
  key: string;
  label: string;
}

interface FilterChipsProps {
  options: FilterChipOption[];
  value: string;
  onChange: (key: string) => void;
  style?: ViewStyle;
}

/** Horizontally scrollable chip row (status/payment filters on Rides). */
export const FilterChips: React.FC<FilterChipsProps> = ({
  options,
  value,
  onChange,
  style,
}) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, style]}
    >
      {options.map((opt) => (
        <Pill
          key={opt.key}
          label={opt.label}
          active={opt.key === value}
          onPress={() => onChange(opt.key)}
          style={styles.chip}
        />
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    paddingHorizontal: 2,
    gap: 8,
  },
  chip: {
    backgroundColor: colors.card,
  },
});
