import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { FileText, Image as ImageIcon, CheckCircle2, CircleSlash } from 'lucide-react-native';
import { colors, radii, typography } from '../../theme/theme';

interface DocumentTileProps {
  label: string;
  state: 'ready' | 'missing';
  /** 'image/*' renders the image icon, anything else the file icon. */
  mime?: string;
  onPress?: () => void;
}

/** Document preview tile on the application detail screen. */
export const DocumentTile: React.FC<DocumentTileProps> = ({ label, state, mime, onPress }) => {
  const ready = state === 'ready';
  const Icon = mime?.startsWith('image/') ? ImageIcon : FileText;

  const body = (
    <View style={styles.body}>
      <View style={[styles.iconWrap, ready ? styles.iconReady : styles.iconMissing]}>
        {ready ? (
          <Icon size={22} color={colors.primary} />
        ) : (
          <CircleSlash size={22} color={colors.textMuted} />
        )}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.stateRow}>
        {ready ? <CheckCircle2 size={13} color={colors.success} /> : null}
        <Text style={[styles.state, ready && styles.stateReady]} numberOfLines={1}>
          {ready ? 'Available' : 'Not provided'}
        </Text>
      </View>
    </View>
  );

  if (ready && onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`View ${label}`}
        style={styles.tile}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.tile, !ready && styles.tileDisabled]}>{body}</View>;
};

const styles = StyleSheet.create({
  tile: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    minHeight: 118,
    justifyContent: 'center',
  },
  tileDisabled: {
    opacity: 0.7,
  },
  body: {
    alignItems: 'center',
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconReady: {
    backgroundColor: colors.accentLight,
  },
  iconMissing: {
    backgroundColor: colors.surface,
  },
  label: {
    ...typography.metaBold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  state: {
    ...typography.meta,
    fontSize: 12,
  },
  stateReady: {
    color: colors.success,
  },
});
