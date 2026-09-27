import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { User as UserIcon, Car } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';
import { Input } from '../../components/primitives/Input';
import { Button } from '../../components/primitives/Button';
import { Pill } from '../../components/primitives/Pill';

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

const VEHICLE_OPTIONS: { id: VehicleType; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'mini', label: 'Mini' },
  { id: 'sedan', label: 'Sedan' },
  { id: 'suv', label: 'SUV' },
];

export const CompleteProfileScreen: React.FC<Props> = ({ role, onSubmit, isSubmitting, serverError }) => {
  const [name, setName] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('sedan');
  const [carModel, setCarModel] = useState('');
  const [plateNumber, setPlateNumber] = useState('');

  const isDriver = role === 'driver';
  const isValid =
    name.trim().length >= 2 &&
    (!isDriver || (carModel.trim().length >= 2 && plateNumber.trim().length >= 4));

  const handleSubmit = () => {
    if (!isDriver) {
      onSubmit(name.trim());
      return;
    }
    onSubmit(name.trim(), {
      vehicleType,
      carModel: carModel.trim(),
      plateNumber: plateNumber.trim().toUpperCase(),
    });
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.iconBadge}>
          <UserIcon size={28} color={colors.primary} />
        </View>
        <Text style={styles.title}>What should we call you?</Text>
        <Text style={styles.subtitle}>This is how {isDriver ? 'riders' : 'drivers'} will see your name</Text>

        <Input
          label="Full name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Vishal Kumar"
          autoFocus
          error={!isDriver ? serverError : undefined}
        />

        {isDriver && (
          <View style={styles.vehicleSection}>
            <View style={styles.vehicleHeaderRow}>
              <Car size={18} color={colors.primary} />
              <Text style={styles.vehicleHeaderText}>Vehicle details</Text>
            </View>

            <Text style={styles.fieldLabel}>Vehicle type</Text>
            <View style={styles.pillRow}>
              {VEHICLE_OPTIONS.map((option) => (
                <Pill
                  key={option.id}
                  label={option.label}
                  active={vehicleType === option.id}
                  onPress={() => setVehicleType(option.id)}
                />
              ))}
            </View>

            <Input label="Car model" value={carModel} onChangeText={setCarModel} placeholder="e.g. Maruti Dzire" />
            <Input
              label="Plate number"
              value={plateNumber}
              onChangeText={(text) => setPlateNumber(text.toUpperCase())}
              placeholder="e.g. TN 45 AB 1234"
              error={serverError}
            />
          </View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Continue"
          onPress={handleSubmit}
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
  vehicleSection: { marginTop: 20, gap: 4 },
  vehicleHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  vehicleHeaderText: { ...typography.bodyBold, fontSize: 15 },
  fieldLabel: { ...typography.metaBold, fontSize: 12, marginBottom: 8, color: colors.textSecondary },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  footer: {
    padding: 20, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
});