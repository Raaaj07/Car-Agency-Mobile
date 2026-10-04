import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { CloudOff } from 'lucide-react-native';
import { Button } from '../primitives/Button';
import { colors, radii, typography } from '../../theme/theme';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: ViewStyle;
}

/** Inline load-failure state with a Retry action (A-7/A-9 recovery). */
export const ErrorState: React.FC<ErrorStateProps> = ({
  message,
  onRetry,
  retryLabel = 'Retry',
  style,
}) => {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.iconWrap}>
        <CloudOff size={26} color={colors.danger} />
      </View>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Button
          title={retryLabel}
          variant="outline"
          size="small"
          fullWidth={false}
          onPress={onRetry}
          style={styles.btn}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 28,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: radii.pill,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  message: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  btn: {
    marginTop: 14,
  },
});
