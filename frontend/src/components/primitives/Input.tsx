import React from 'react';
import { View, TextInput, Text, StyleSheet, ViewStyle, TextStyle, TouchableOpacity } from 'react-native';
import { colors, radii, typography } from '../../theme/theme';

interface InputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  error?: string;
  helperText?: string;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  maxLength?: number;
  autoFocus?: boolean;
  isPhoneInput?: boolean;
  countryCode?: string;
  style?: ViewStyle;
  inputStyle?: TextStyle;
}

export const Input: React.FC<InputProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  leftIcon,
  rightIcon,
  error,
  helperText,
  keyboardType = 'default',
  maxLength,
  autoFocus,
  isPhoneInput = false,
  countryCode = '+91',
  style,
  inputStyle,
}) => {
  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputBox, error ? styles.inputError : null]}>
        {isPhoneInput && (
          <View style={styles.countryBadge}>
            <Text style={styles.countryText}>{countryCode}</Text>
            <View style={styles.divider} />
          </View>
        )}
        {leftIcon && <View style={styles.iconContainer}>{leftIcon}</View>}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          maxLength={maxLength}
          autoFocus={autoFocus}
          style={[styles.input, inputStyle]}
        />
        {rightIcon && <View style={styles.iconContainer}>{rightIcon}</View>}
      </View>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
};

interface OTPInputProps {
  code: string[];
  setCode: (code: string[]) => void;
  length?: number;
}

export const OTPInput: React.FC<OTPInputProps> = ({ code, setCode, length = 4 }) => {
  const inputs = React.useRef<Array<TextInput | null>>([]);

  const handleChange = (text: string, index: number) => {
    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);

    if (text.length > 0 && index < length - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  return (
    <View style={styles.otpRow}>
      {Array.from({ length }).map((_, index) => (
        <TextInput
          key={index}
          ref={(ref) => {
            inputs.current[index] = ref;
          }}
          value={code[index] || ''}
          onChangeText={(text) => handleChange(text, index)}
          onKeyPress={(e) => handleKeyPress(e, index)}
          keyboardType="numeric"
          maxLength={1}
          style={[styles.otpBox, code[index] ? styles.otpBoxFilled : null]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    width: '100%',
  },
  label: {
    ...typography.metaBold,
    color: colors.textPrimary,
    marginBottom: 6,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: radii.input,
    paddingHorizontal: 14,
    height: 52,
  },
  inputError: {
    borderColor: colors.danger,
  },
  countryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  countryText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: colors.border,
    marginLeft: 10,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    height: '100%',
  },
  errorText: {
    ...typography.meta,
    color: colors.danger,
    marginTop: 4,
  },
  helperText: {
    ...typography.meta,
    color: colors.textMuted,
    marginTop: 4,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 20,
    width: '100%',
    paddingHorizontal: 20,
  },
  otpBox: {
    width: 60,
    height: 64,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  otpBoxFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.accentLight,
  },
});
