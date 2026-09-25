import React from 'react';
import { View, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';
import { colors, radii, shadows } from '../../theme/theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  selected?: boolean;
  padded?: boolean;
  shadow?: boolean;
  bordered?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  onPress,
  selected = false,
  padded = true,
  shadow = true,
  bordered = true,
}) => {
  const containerStyles: ViewStyle[] = [
    styles.card,
    padded && styles.padded,
    shadow && shadows.card,
    bordered && styles.border,
    selected && styles.selectedBorder,
    style as ViewStyle,
  ].filter(Boolean) as ViewStyle[];

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={containerStyles}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyles}>{children}</View>;
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  padded: {
    padding: 16,
  },
  border: {
    borderWidth: 1,
    borderColor: '#EEECF2',
  },
  selectedBorder: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.accentLight,
  },
});
