import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle, ActivityIndicator } from 'react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'accent' | 'outline' | 'danger' | 'ghost' | 'success';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  fullWidth = true,
  disabled = false,
  loading = false,
  leftIcon,
  rightIcon,
  style,
  textStyle,
}) => {
  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case 'accent':
        return { backgroundColor: colors.accent };
      case 'danger':
        return { backgroundColor: colors.danger };
      case 'success':
        return { backgroundColor: colors.success };
      case 'outline':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: colors.primary,
        };
      case 'ghost':
        return { backgroundColor: 'transparent' };
      case 'primary':
      default:
        return { backgroundColor: colors.primary };
    }
  };

  const getTextStyle = (): TextStyle => {
    switch (variant) {
      case 'outline':
      case 'ghost':
        return { color: colors.primary };
      default:
        return { color: colors.textLight };
    }
  };

  const getSizeStyle = (): { height: number; paddingHorizontal: number; fontSize: number } => {
    switch (size) {
      case 'small':
        return { height: 40, paddingHorizontal: 16, fontSize: 14 };
      case 'large':
        return { height: 56, paddingHorizontal: 24, fontSize: 17 };
      case 'medium':
      default:
        return { height: 48, paddingHorizontal: 20, fontSize: 16 };
    }
  };

  const sizeInfo = getSizeStyle();

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        getVariantStyle(),
        {
          height: sizeInfo.height,
          paddingHorizontal: sizeInfo.paddingHorizontal,
          width: fullWidth ? '100%' : 'auto',
          opacity: disabled ? 0.6 : 1,
        },
        variant === 'primary' || variant === 'accent' ? shadows.button : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' || variant === 'ghost' ? colors.primary : '#FFF'} />
      ) : (
        <>
          {leftIcon && <React.Fragment>{leftIcon}</React.Fragment>}
          <Text
            style={[
              typography.buttonText,
              getTextStyle(),
              { fontSize: sizeInfo.fontSize },
              leftIcon ? { marginLeft: 8 } : null,
              rightIcon ? { marginRight: 8 } : null,
              textStyle,
            ]}
          >
            {title}
          </Text>
          {rightIcon && <React.Fragment>{rightIcon}</React.Fragment>}
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
