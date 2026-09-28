import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { LogOut, Car } from 'lucide-react-native';
import { colors, typography, radii } from '../../theme/theme';
import { useAuthStore } from '../../store/authStore';
import { useRideStore } from '../../store/rideStore';
import { driversApi, DriverProfile, VehicleType } from '../../api/drivers';
import { getApiError } from '../../api/client';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { Pill } from '../../components/primitives/Pill';

const VEHICLE_TYPES: { id: VehicleType; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'mini', label: 'Mini' },
  { id: 'sedan', label: 'Sedan' },
  { id: 'suv', label: 'SUV' },
];

export const DriverAccountScreen: React.FC = () => {
  const logout = useAuthStore((s) => s.logout);
  const resetRide = useRideStore((s) => s.resetRide);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType>('sedan');
  const [carModel, setCarModel] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = () => {
    driversApi
      .getMyProfile()
      .then((p) => {
        setProfile(p);
        setVehicleType(p.vehicleType);
        setCarModel(p.carModel);
        setPlateNumber(p.plateNumber);
      })
      .catch(() => {
        // No driver profile yet — fine, this screen is exactly where they register one.
      });
  };

  useEffect(load, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError(undefined);
    try {
      await driversApi.register({ vehicleType, carModel: carModel.trim(), plateNumber: plateNumber.trim().toUpperCase() });
      load();
      Alert.alert('Saved', 'Your vehicle details have been updated.');
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    // Best-effort — if this fails (e.g. no driver profile registered yet),
    // logging out still proceeds; we just don't want an online driver
    // silently staying "available" after they've left the app.
    try {
      await driversApi.setStatus(false);
    } catch {
      // ignore
    }
    resetRide();
    logout();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Avatar name={profile?.name ?? '?'} uri={profile?.avatar ?? undefined} size={72} />
        <Text style={styles.name}>{profile?.name ?? 'Driver'}</Text>
        <Text style={styles.phone}>{profile?.phone}</Text>
        {profile && (
          <Text style={styles.ratingLine}>
            {profile.rating.toFixed(1)} ★ · {profile.totalTrips} lifetime trips
          </Text>
        )}
      </View>

      <Card style={styles.card}>
        <View style={styles.cardTitleRow}>
          <Car size={18} color={colors.primary} />
          <Text style={styles.cardTitle}>Vehicle & Documents</Text>
        </View>

        <Text style={styles.fieldLabel}>Vehicle type</Text>
        <View style={styles.pillRow}>
          {VEHICLE_TYPES.map(({ id, label }) => (
            <Pill
              key={id}
              label={label}
              active={vehicleType === id}
              onPress={() => setVehicleType(id)}
            />
          ))}
        </View>

        <Input label="Car model" value={carModel} onChangeText={setCarModel} placeholder="e.g. Maruti Dzire" />
        <Input
          label="Plate number"
          value={plateNumber}
          onChangeText={(text) => setPlateNumber(text.toUpperCase())}
          placeholder="e.g. TN 45 AB 1234"
          error={error}
        />

        <Button
          title={profile ? 'Update details' : 'Register vehicle'}
          onPress={handleSave}
          loading={isSaving}
          disabled={isSaving || !carModel.trim() || !plateNumber.trim()}
          style={styles.saveBtn}
        />
      </Card>

      <Button
        title="Log out"
        variant="ghost"
        onPress={() =>
          Alert.alert('Log out?', 'You will need to sign in again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: handleLogout },
          ])
        }
        leftIcon={<LogOut size={18} color={colors.danger} />}
        style={styles.logoutBtn}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 60 },
  header: { alignItems: 'center', marginBottom: 24 },
  name: { ...typography.heading, fontSize: 22, marginTop: 12 },
  phone: { ...typography.body, color: colors.textMuted },
  ratingLine: { ...typography.meta, marginTop: 4 },
  card: { marginBottom: 24 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardTitle: { ...typography.cardTitle, fontSize: 16 },
  fieldLabel: { ...typography.meta, marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  saveBtn: { marginTop: 8 },
  logoutBtn: { marginTop: 8 },
});