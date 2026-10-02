import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { User as UserIcon } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';
import { Input } from '../../components/primitives/Input';
import { Button } from '../../components/primitives/Button';

export type VehicleType = 'auto' | 'mini' | 'sedan' | 'suv';

export interface VehicleDetails {
  vehicleType: VehicleType;
  carModel: string;
  plateNumber: string;
}

interface Props {
  role?: 'rider' | 'driver' | null;
  onSubmit: (name: string, vehicle?: VehicleDetails) => void;
  isSubmitting?: boolean;
  serverError?: string;
}

// Single onboarding for everyone: just a display name.
// Driver vehicle + documents moved to Profile > Become a Driver.
export const CompleteProfileScreen: React.FC<Props> = ({ onSubmit, isSubmitting, serverError }) => {
  const [name, setName] = useState('');

  const isValid = name.trim().length >= 2;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.iconBadge}>
          <UserIcon size={28} color={colors.primary} />
        </View>
        <Text style={styles.title}>What should we call you?</Text>
        <Text style={styles.subtitle}>This is how drivers will see your name. You can become a driver later from your Profile.</Text>

        <Input
          label="Full name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Vishal Kumar"
          autoFocus
          error={serverError}
        />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Continue"
          onPress={() => onSubmit(name.trim())}
          variant="primary"
          size="large"
          disabled={!isValid || isSubmitting}
          loading={isSubmitting}
        />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  iconBadge: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: { ...typography.heading, fontSize: 24, marginBottom: 6 },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: 28 },
  footer: {
    padding: 20, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
});
