import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { Car, BadgeCheck } from 'lucide-react-native';
import { colors, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { Pill } from '../../components/primitives/Pill';
import { DocumentUploader } from '../../components/primitives/DocumentUploader';
import { Header } from '../../components/primitives/Header';
import { driversApi, VehicleType } from '../../api/drivers';
import { getApiError } from '../../api/client';

const VEHICLE_TYPES: { id: VehicleType; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'mini', label: 'Mini' },
  { id: 'sedan', label: 'Sedan' },
  { id: 'suv', label: 'SUV' },
];

const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  onBack: () => void;
  onDone: () => void;
}

function fileFromUri(uri: string, fallback: string) {
  const name = uri.split('/').pop() || fallback;
  const lower = name.toLowerCase();
  const type = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
  return { uri, name, type };
}

export const BecomeDriverScreen: React.FC<Props> = ({ onBack, onDone }) => {
  const [vehicleType, setVehicleType] = useState<VehicleType>('sedan');
  const [carModel, setCarModel] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [rcNumber, setRcNumber] = useState('');
  const [carPhoto, setCarPhoto] = useState<string | null>(null);
  const [licencePhoto, setLicencePhoto] = useState<string | null>(null);
  const [rcPhoto, setRcPhoto] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>();

  const isValid =
    carModel.trim().length >= 2 &&
    plateNumber.trim().length >= 4 &&
    licenceNumber.trim().length >= 4 &&
    !!licencePhoto &&
    !!rcPhoto;

  const handleSubmit = async () => {
    setIsSaving(true);
    setProgress(null);
    setError(undefined);
    try {
      await driversApi.apply(
        {
          vehicleType,
          carModel: carModel.trim(),
          plateNumber: plateNumber.trim().toUpperCase(),
          licenseNumber: licenceNumber.trim().toUpperCase(),
          rcNumber: rcNumber.trim() ? rcNumber.trim().toUpperCase() : undefined,
        },
        {
          licenseImage: fileFromUri(licencePhoto!, 'license.jpg'),
          rcImage: fileFromUri(rcPhoto!, 'rc.jpg'),
          ...(carPhoto ? { vehiclePhoto: fileFromUri(carPhoto, 'car.jpg') } : {}),
        },
        (pct) => setProgress(pct),
      );
      Alert.alert('Application submitted', 'Our team will review your documents. You will be notified once approved.');
      onDone();
    } catch (err) {
      const msg = getApiError(err);
      // Surface size/type failures plainly (server validates magic bytes + 5 MB).
      setError(msg.includes('exceeds') || msg.includes('only JPEG') || msg.includes('does not match') ? msg : msg);
    } finally {
      setIsSaving(false);
      setProgress(null);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Become a driver" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.infoBox}>
          <BadgeCheck size={20} color={colors.success} />
          <Text style={styles.infoText}>Applications are reviewed by our team. Only approved drivers can go online.</Text>
        </View>

        <View style={styles.sectionHead}>
          <Car size={18} color={colors.primary} />
          <Text style={styles.sectionTitle}>Vehicle</Text>
        </View>
        <Text style={styles.fieldLabel}>Vehicle type</Text>
        <View style={styles.pillRow}>
          {VEHICLE_TYPES.map(({ id, label }) => (
            <Pill key={id} label={label} active={vehicleType === id} onPress={() => setVehicleType(id)} />
          ))}
        </View>
        <Input label="Car model" value={carModel} onChangeText={setCarModel} placeholder="e.g. Maruti Dzire" />
        <Input label="Plate number" value={plateNumber} onChangeText={(t) => setPlateNumber(t.toUpperCase())} placeholder="e.g. TN 45 AB 1234" />

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Documents (JPEG/PNG/PDF, max 5 MB each)</Text>
        </View>
        <Input label="Driving licence number" value={licenceNumber} onChangeText={(t) => setLicenceNumber(t.toUpperCase())} placeholder="e.g. TN4520250012345" />
        <Input label="RC number (optional)" value={rcNumber} onChangeText={(t) => setRcNumber(t.toUpperCase())} placeholder="e.g. TN45AB1234" />

        <DocumentUploader label="Driving licence *" hint="Front side of licence card (required)" value={licencePhoto} onChange={setLicencePhoto} />
        <DocumentUploader label="RC book *" hint="Registration certificate (required)" value={rcPhoto} onChange={setRcPhoto} />
        <DocumentUploader label="Car photo" hint="Front view with plate visible (optional)" value={carPhoto} onChange={setCarPhoto} />

        {progress != null && <Text style={styles.progress}>Uploading… {progress}%</Text>}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.note}>Max file size: {Math.round(MAX_BYTES / 1024 / 1024)} MB per document.</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Submit application" onPress={handleSubmit} loading={isSaving} disabled={!isValid || isSaving} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 120 },
  infoBox: { flexDirection: 'row', gap: 10, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', padding: 12, borderRadius: 12, marginBottom: 18, alignItems: 'center' },
  infoText: { ...typography.meta, fontSize: 12, flex: 1, color: colors.textPrimary },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 },
  sectionTitle: { ...typography.cardTitle, fontSize: 16 },
  fieldLabel: { ...typography.metaBold, fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  progress: { ...typography.bodyBold, fontSize: 13, color: colors.primary, marginTop: 8 },
  error: { color: colors.danger, fontSize: 13, marginTop: 8 },
  note: { ...typography.meta, fontSize: 11, color: colors.textMuted, marginTop: 8 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 16, borderTopWidth: 1, borderTopColor: colors.borderLight, ...shadows.card },
});
