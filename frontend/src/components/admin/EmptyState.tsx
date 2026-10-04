import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Inbox } from 'lucide-react-native';
import { colors, radii, typography } from '../../theme/theme';

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: React.ReactNode;
  /** e.g. a "Clear filters" button. */
  action?: React.ReactNode;
  style?: ViewStyle;
}

/** Friendly empty list state (per-segment copy on Drivers, no results, …). */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  message,
  icon,
  action,
  style,
}) => {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.iconWrap}>{icon ?? <Inbox size={30} color={colors.textMuted} />}</View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 44,
    paddingHorizontal: 28,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    ...typography.cardTitle,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    textAlign: 'center',
    marginTop: 6,
  },
  action: {
    marginTop: 16,
    alignSelf: 'stretch',
  },
});
