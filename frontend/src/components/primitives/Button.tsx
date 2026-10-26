import React, { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle, ActivityIndicator } from 'react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';

// A genuine second press is never this fast; a double-tap always is.
const PRESS_COOLDOWN_MS = 500;

interface ButtonProps {
  title: string;
  /**
   * May return a Promise. When it does, the button locks itself (spinner, no
   * further taps) until that promise settles, so a double/triple tap on any
   * async action (book, cancel, pay, submit...) can never run it twice.
   */
  onPress: () => void | Promise<unknown>;
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
  // Anti double-tap. The ref blocks a second tap in the SAME frame (state
  // updates are async, so `busy` alone would let a fast second tap through).
  const pressLock = useRef(false);
  // Also swallows a second tap of ANY button within a short window: stops the
  // classic double navigation push (two screens opened by one fast double tap)
  // even for handlers that return nothing.
  const lastPressAt = useRef(0);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const handlePress = () => {
    if (pressLock.current) return;
    const now = Date.now();
    if (now - lastPressAt.current < PRESS_COOLDOWN_MS) return;
    lastPressAt.current = now;
    const result = onPress();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      pressLock.current = true;
      setBusy(true);
      const release = () => {
        pressLock.current = false;
        if (mounted.current) setBusy(false);
      };
      (result as Promise<unknown>).then(release, release);
    }
  };

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
      onPress={handlePress}
      disabled={disabled || loading || busy}
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
      {loading || busy ? (
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
