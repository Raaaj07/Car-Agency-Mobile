import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { QrCode } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, typography } from '../../theme/theme';
import { Header } from '../../components/primitives/Header';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { driversApi } from '../../api/drivers';
import { getApiError } from '../../api/client';
import { savePayeeUpi } from '../../lib/payeeUpi';
import { isValidUpiId } from '../../utils/upi';

interface Props {
  onBack: () => void;
}

// D-1: the payee VPA the post-trip payment QR is generated from. The edit
// flow is the same one the old Profile screen carried — moved here to match
// the "Payment & QR" row in the driver profile.
export const PaymentQrScreen: React.FC<Props> = ({ onBack }) => {
  const [upiSaved, setUpiSaved] = useState<string | null>(null);
  const [upiEditing, setUpiEditing] = useState(false);
  const [upiInput, setUpiInput] = useState('');
  const [upiSaving, setUpiSaving] = useState(false);
  const [upiError, setUpiError] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      driversApi
        .getMyProfile()
        .then((p) => {
          if (cancelled) return;
          setUpiSaved(p?.upiVpa?.trim() || null);
          setLoaded(true);
        })
        .catch((err) => {
          if (cancelled) return;
          setLoadError(getApiError(err));
          setLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const startUpiEdit = () => {
    setUpiInput(upiSaved ?? '');
    setUpiError(undefined);
    setUpiEditing(true);
  };

  const handleSaveUpi = async () => {
    setUpiSaving(true);
    setUpiError(undefined);
    const result = await savePayeeUpi(upiInput);
    setUpiSaving(false);
    if (result.ok) {
      setUpiSaved(result.vpa);
      setUpiInput('');
      setUpiEditing(false);
    } else {
      // Shown inline: the ID must really be stored on the profile, otherwise
      // the payment QR and what admins see could disagree.
      setUpiError(result.error);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Payment & QR" onBack={onBack} transparent />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <QrCode size={18} color={colors.primary} />
            </View>
            <Text style={styles.title}>Payment UPI ID</Text>
          </View>

          {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

          {upiSaved && !upiEditing ? (
            <>
              <Text style={styles.upiValue} selectable>
                {upiSaved}
              </Text>
              <Text style={styles.metaLine}>
                After each trip, riders scan a QR code that pays the fare directly to this UPI ID.
              </Text>
              <Button title="Change UPI ID" variant="outline" onPress={startUpiEdit} style={styles.actionBtn} />
            </>
          ) : (
            <>
              {!upiSaved && (
                <Text style={styles.upiWarning}>
                  Add your UPI ID, or the payment QR can&apos;t be generated after a trip.
                </Text>
              )}
              <Input
                label="UPI ID"
                value={upiInput}
                onChangeText={(t) => {
                  setUpiInput(t);
                  if (upiError) setUpiError(undefined);
                }}
                placeholder="yourname@okhdfcbank"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                error={upiError}
                helperText="Found in GPay / PhonePe / Paytm under your profile, e.g. name@okaxis"
                style={styles.upiInput}
              />
              <View style={styles.editRow}>
                {upiSaved ? (
                  <Button
                    title="Cancel"
                    variant="outline"
                    onPress={() => {
                      setUpiEditing(false);
                      setUpiError(undefined);
                    }}
                    style={styles.editBtn}
                  />
                ) : null}
                <Button
                  title="Save UPI ID"
                  onPress={handleSaveUpi}
                  loading={upiSaving}
                  disabled={upiSaving || !isValidUpiId(upiInput) || upiInput.trim() === upiSaved}
                  style={styles.editBtn}
                />
              </View>
            </>
          )}

          {!loaded ? <Text style={styles.metaLine}>Loading…</Text> : null}
        </Card>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  card: { marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  titleIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.cardTitle, fontSize: 16 },
  upiValue: { ...typography.bodyBold, fontSize: 18, color: colors.textPrimary, marginTop: 8 },
  metaLine: { ...typography.meta, fontSize: 12, color: colors.textMuted, marginTop: 8 },
  upiWarning: { ...typography.meta, fontSize: 13, color: colors.warning, marginTop: 8 },
  errorText: { ...typography.meta, fontSize: 13, color: colors.danger, marginTop: 8 },
  upiInput: { marginTop: 10 },
  editRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  editBtn: { flex: 1 },
  actionBtn: { marginTop: 14 },
});
