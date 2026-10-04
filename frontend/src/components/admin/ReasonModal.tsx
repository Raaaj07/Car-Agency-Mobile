import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { Button } from '../primitives/Button';
import { colors, radii, shadows, typography } from '../../theme/theme';

interface ReasonModalProps {
  visible: boolean;
  title: string;
  /** Explains what the reason is used for (shown under the title). */
  description?: string;
  /** Controlled text — parent owns it (cleared when opening). */
  value: string;
  onChange: (value: string) => void;
  onSubmit: (reason: string) => void;
  onClose: () => void;
  submitLabel?: string;
  destructive?: boolean;
  min?: number;
  max?: number;
}

/**
 * Reason entry sheet (spec §3.3): live character counter, submit disabled
 * below `min` chars, destructive styling for suspend/cancel. Controlled so
 * there is no setState inside effects (A-9 lint hygiene).
 */
export const ReasonModal: React.FC<ReasonModalProps> = ({
  visible,
  title,
  description,
  value,
  onChange,
  onSubmit,
  onClose,
  submitLabel = 'Confirm',
  destructive = false,
  min = 5,
  max = 300,
}) => {
  const trimmed = value.trim();
  const valid = trimmed.length >= min && trimmed.length <= max;

  const submit = () => {
    if (!valid) return;
    onSubmit(trimmed);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}

          <View style={styles.inputBox}>
            <MultiLine
              value={value}
              onChangeText={onChange}
              max={max}
              minLines={3}
            />
            <Text style={[styles.counter, valid && styles.counterValid]}>
              {trimmed.length}/{max}
            </Text>
          </View>

          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="ghost"
              size="medium"
              fullWidth={false}
              onPress={onClose}
              style={styles.actionBtn}
            />
            <Button
              title={submitLabel}
              variant={destructive ? 'danger' : 'primary'}
              size="medium"
              fullWidth={false}
              disabled={!valid}
              onPress={submit}
              style={styles.actionBtn}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// Kept as a tiny internal component so the modal stays one file.
const MultiLine: React.FC<{
  value: string;
  onChangeText: (t: string) => void;
  max: number;
  minLines: number;
}> = ({ value, onChangeText, max, minLines }) => (
  <TextInput
    value={value}
    onChangeText={onChangeText}
    placeholder="Describe the reason (required)…"
    placeholderTextColor={colors.textMuted}
    multiline
    maxLength={max}
    textAlignVertical="top"
    style={[styles.input, { minHeight: 20 * minLines * 1.6 }]}
    accessibilityLabel="Reason"
  />
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: 20,
    paddingBottom: 28,
    ...shadows.modal,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  title: {
    ...typography.subheading,
  },
  description: {
    ...typography.body,
    fontSize: 14,
    marginTop: 4,
  },
  inputBox: {
    marginTop: 14,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  input: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    padding: 0,
  },
  counter: {
    ...typography.meta,
    textAlign: 'right',
    marginTop: 6,
  },
  counterValid: {
    color: colors.success,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    minWidth: 120,
  },
});
