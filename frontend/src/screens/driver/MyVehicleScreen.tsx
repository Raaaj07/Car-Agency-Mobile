import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { BadgeCheck, Car } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, typography } from '../../theme/theme';
import { Header } from '../../components/primitives/Header';
import { Card } from '../../components/primitives/Card';
import { driversApi, DriverApplication, DriverProfile } from '../../api/drivers';
import { getApiError } from '../../api/client';

interface Props {
  onBack: () => void;
}

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Read-only "My Vehicle": what the driver told us at onboarding plus the
// document checklist — no driver-editable fields exist server-side, so the
// screen points to support for changes.
export const MyVehicleScreen: React.FC<Props> = ({ onBack }) => {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [application, setApplication] = useState<DriverApplication | null>(null);
  const [error, setError] = useState<string | undefined>();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      driversApi
        .getMyProfile()
        .then((p) => {
          if (!cancelled) setProfile(p);
        })
        .catch((err) => {
          if (!cancelled) setError(getApiError(err));
        });
      driversApi
        .application()
        .then((a) => {
          if (!cancelled) setApplication(a);
        })
        .catch(() => {
          // Document flags are optional — the vehicle card still renders.
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <View style={styles.container}>
      <Header title="My Vehicle" onBack={onBack} transparent />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {profile ? (
          <Card style={styles.card}>
            <View style={styles.titleRow}>
              <View style={styles.titleIcon}>
                <Car size={18} color={colors.primary} />
              </View>
              <Text style={styles.title}>{label(profile.vehicleType)} · {profile.carModel}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Plate number</Text>
              <Text style={styles.specValue} selectable>{profile.plateNumber}</Text>
            </View>
            {profile.drivingLicenceNumber ? (
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Driving licence</Text>
                <Text style={styles.specValue} selectable>{profile.drivingLicenceNumber}</Text>
              </View>
            ) : null}
            {profile.rcNumber ? (
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>RC number</Text>
                <Text style={styles.specValue} selectable>{profile.rcNumber}</Text>
              </View>
            ) : null}
            {profile.status === 'approved' ? (
              <View style={styles.verifiedRow}>
                <BadgeCheck size={16} color={colors.success} />
                <Text style={styles.verifiedText}>Verified by Vazhi</Text>
              </View>
            ) : null}
          </Card>
        ) : !error ? (
          <Text style={styles.metaText}>Loading vehicle…</Text>
        ) : null}

        {application ? (
          <Card style={styles.card}>
            <Text style={styles.title}>Documents on file</Text>
            <Text style={styles.docItem}>{application.hasLicenseImage ? '✓' : '—'} Driving licence photo</Text>
            <Text style={styles.docItem}>{application.hasRcImage ? '✓' : '—'} RC photo</Text>
            <Text style={styles.docItem}>{application.hasVehiclePhoto ? '✓' : '—'} Vehicle photo</Text>
            <Text style={styles.metaText}>
              Need to change your vehicle or document details? Contact support from the Help &
              support screen.
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  card: { marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.cardTitle, fontSize: 16, flex: 1 },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 12 },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  specLabel: { ...typography.meta, fontSize: 13, color: colors.textMuted },
  specValue: { ...typography.bodyBold, fontSize: 14 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  verifiedText: { ...typography.meta, fontSize: 13, color: colors.success, fontWeight: '700' },
  docItem: { ...typography.body, fontSize: 14, color: colors.textSecondary, marginTop: 8 },
  metaText: { ...typography.meta, fontSize: 12, color: colors.textMuted, marginTop: 12 },
  errorText: { ...typography.meta, fontSize: 13, color: colors.danger, marginBottom: 12 },
});
