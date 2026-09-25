import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle, TextStyle } from 'react-native';
import { colors, radii, typography } from '../../theme/theme';

interface PillProps {
  label: string;
  variant?: 'primary' | 'accent' | 'success' | 'danger' | 'warning' | 'muted' | 'outline';
  active?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const Pill: React.FC<PillProps> = ({
  label,
  variant = 'muted',
  active = false,
  onPress,
  icon,
  style,
  textStyle,
}) => {
  const getColors = (): { bg: string; text: string; border?: string } => {
    if (active) {
      return { bg: colors.primary, text: colors.textLight };
    }
    switch (variant) {
      case 'primary':
        return { bg: colors.primary, text: colors.textLight };
      case 'accent':
        return { bg: colors.accent, text: colors.textLight };
      case 'success':
        return { bg: colors.successLight, text: colors.success };
      case 'danger':
        return { bg: colors.dangerLight, text: colors.danger };
      case 'warning':
        return { bg: colors.warningLight, text: colors.warning };
      case 'outline':
        return { bg: 'transparent', text: colors.textPrimary, border: colors.border };
      case 'muted':
      default:
        return { bg: '#EFECE9', text: colors.textPrimary };
    }
  };

  const palette = getColors();

  const content = (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border || 'transparent',
          borderWidth: palette.border ? 1 : 0,
        },
        style,
      ]}
    >
      {icon && <View style={styles.iconWrap}>{icon}</View>}
      <Text style={[typography.metaBold, { color: palette.text }, textStyle]}>{label}</Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  pill: {
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  iconWrap: {
    marginRight: 6,
  },
});
