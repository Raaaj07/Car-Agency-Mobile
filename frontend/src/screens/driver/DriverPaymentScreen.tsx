import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as SecureStore from 'expo-secure-store';
import { QrCode, CheckCircle2, IndianRupee } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { useRideStore } from '../../store/rideStore';
import { useAuthStore } from '../../store/authStore';
import { ridesApi } from '../../api/rides';
import { driversApi } from '../../api/drivers';
import { getApiError } from '../../api/client';
import { buildUpiPaymentUrl, isValidUpiId } from '../../utils/upi';

// D-1: SecureStore is the offline/pre-approval fallback; the profile VPA
// (driversApi.getMyProfile) is the source of truth the admin can see.
const UPI_ID_KEY = 'driver_upi_id';

interface Props {
  onDone: () => void;
}

/**
 * Collect Payment (shown right after the driver completes a trip).
 * Auto-generates a GPay/PhonePe/Paytm-compatible UPI QR for the exact ride
 * cost, using the UPI ID the driver enters here. After the rider pays, the
 * driver taps "Amount Received" — that flag is what the admin console shows.
 */
export const DriverPaymentScreen: React.FC<Props> = ({ onDone }) => {
  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const driverName = useAuthStore((state) => state.user?.name);

  const fareTotal = Number(activeRide?.fareBreakdown?.total ?? 0);
  const tip = Number(activeRide?.tipAmount ?? 0);
  const amount = fareTotal + tip;
  const isPaid = activeRide?.paymentStatus === 'paid';
  // P-1: the driver can't settle a disputed payment — admin resolves it.
  const isDisputed = activeRide?.paymentStatus === 'disputed';

  const [vpaInput, setVpaInput] = useState('');
  const [savedVpa, setSavedVpa] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Restore the payee UPI ID: profile first (admin-visible, audited), then
  // whatever this device stored (offline or not yet approved).
  useEffect(() => {
    let mounted = true;
    driversApi
      .getMyProfile()
      .then((profile) => profile?.upiVpa?.trim() ?? null)
      .catch(() => null)
      .then((serverVpa) => {
        if (serverVpa) {
          if (mounted) {
            setVpaInput(serverVpa);
            setSavedVpa(serverVpa);
          }
          return null;
        }
        return SecureStore.getItemAsync(UPI_ID_KEY);
      })
      .then((local) => {
        if (mounted && local) {
          setVpaInput(local);
          setSavedVpa(local);
        }
      })
      .catch(() => {
        // Offline — device-stored payee still generates a working QR.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const inputValid = isValidUpiId(vpaInput);

  const saveVpa = async () => {
    const trimmed = vpaInput.trim();
    if (!isValidUpiId(trimmed)) return;
    setSavedVpa(trimmed);
    try {
      await SecureStore.setItemAsync(UPI_ID_KEY, trimmed);
    } catch {
      // Non-fatal: QR still works for this session from local state.
    }
    // D-1: also persist on the profile so the admin ride detail can verify
    // what the QR paid to (403 for non-approved drivers — local copy stands).
    try {
      await driversApi.setUpiVpa(trimmed);
    } catch {
      // Audit/server copy unavailable — collection must not be blocked.
    }
  };

  // QR regenerates automatically whenever the ride amount or the UPI ID
  // changes — it is derived, never hand-built.
  const qrValue =
    isValidUpiId(savedVpa) && amount > 0
      ? buildUpiPaymentUrl({
          vpa: savedVpa,
          payeeName: driverName?.trim() || 'Driver',
          amount,
          note: `Vazhi ride fare`,
        })
      : null;

  const markReceived = async () => {
    if (!activeRide || isPaid || submitting) return;
    setSubmitting(true);
    try {
      const updated = await ridesApi.markPaymentReceived(activeRide.id);
      setActiveRide(updated);
    } catch (error) {
      Alert.alert('Unable to update payment', getApiError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Amount header */}
        <View style={styles.headerBox}>
          <View style={styles.amountRow}>
            <IndianRupee size={26} color={colors.accent} />
            <Text style={styles.amount}>{amount.toFixed(2)}</Text>
          </View>
          <Pill
            label={isPaid ? 'AMOUNT RECEIVED' : isDisputed ? 'DISPUTED' : 'AWAITING PAYMENT'}
            variant={isPaid ? 'success' : isDisputed ? 'danger' : 'warning'}
          />
          <Text style={styles.amountSub}>
            Trip fare ₹{fareTotal.toFixed(2)}
            {tip > 0 ? ` • Tip ₹${tip.toFixed(2)}` : ''}
          </Text>
        </View>

        {/* Auto-generated UPI QR */}
        <Card style={styles.qrCard}>
          <View style={styles.qrTitleRow}>
            <QrCode size={18} color={colors.primary} />
            <Text style={styles.cardTitle}>COLLECT VIA UPI QR</Text>
          </View>

          {qrValue ? (
            <View style={styles.qrWrap}>
              <QRCode value={qrValue} size={210} backgroundColor="#FFFFFF" color="#000000" />
            </View>
          ) : (
            <View style={styles.qrPlaceholder}>
              <Text style={styles.qrPlaceholderText}>
                Enter your UPI ID below to generate the payment QR for ₹{amount.toFixed(2)}
              </Text>
            </View>
          )}

          <Text style={styles.qrHint}>
            Ask the rider to scan this code with GPay, PhonePe or Paytm — the amount is pre-filled.
          </Text>

          <View style={styles.vpaRow}>
            <TextInput
              style={styles.vpaInput}
              value={vpaInput}
              onChangeText={setVpaInput}
              placeholder="yourname@upi"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={saveVpa}
            />
            <Button
              title="Save"
              onPress={saveVpa}
              variant="outline"
              size="small"
              disabled={!inputValid || vpaInput.trim() === savedVpa}
            />
          </View>
          {savedVpa && inputValid ? (
            <Text style={styles.payeeText}>Paying to: {savedVpa}</Text>
          ) : (
            <Text style={styles.payeeError}>QR code is generated from your UPI ID and the ride amount.</Text>
          )}
        </Card>

        {/* Amount received confirmation */}
        {isPaid ? (
          <View style={styles.receivedBox}>
            <CheckCircle2 size={22} color={colors.success} />
            <Text style={styles.receivedText}>
              Amount received — recorded and visible to admin.
            </Text>
          </View>
        ) : isDisputed ? (
          <View style={styles.disputedBox}>
            <Text style={styles.disputedText}>
              This payment is disputed — an admin must resolve it. Nothing to collect in the app.
            </Text>
          </View>
        ) : (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmText}>
              After the rider pays, tap below so the payment is recorded for admin.
            </Text>
            <Button
              title="Amount Received"
              onPress={markReceived}
              variant="success"
              size="large"
              loading={submitting}
              disabled={submitting || !activeRide}
              leftIcon={<CheckCircle2 size={20} color="#FFFFFF" />}
            />
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Continue" onPress={onDone} variant="primary" size="large" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
    gap: 16,
  },
  headerBox: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.card,
    padding: 22,
    gap: 8,
    ...shadows.card,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  amount: {
    ...typography.heading,
    fontSize: 34,
    color: colors.accent,
  },
  amountSub: {
    ...typography.meta,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  qrCard: {
    padding: 18,
    alignItems: 'center',
    gap: 12,
  },
  qrTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  cardTitle: {
    ...typography.metaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  qrWrap: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  qrPlaceholder: {
    width: 210,
    height: 210,
    borderRadius: radii.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#FAF9F7',
  },
  qrPlaceholderText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  qrHint: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  vpaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
  },
  vpaInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  payeeText: {
    ...typography.meta,
    fontSize: 12,
    color: colors.success,
    alignSelf: 'flex-start',
  },
  payeeError: {
    ...typography.meta,
    fontSize: 12,
    color: colors.warning,
    alignSelf: 'flex-start',
  },
  confirmBox: {
    gap: 10,
  },
  confirmText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  receivedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.successLight,
    borderRadius: radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  receivedText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },
  disputedBox: {
    gap: 10,
    backgroundColor: colors.dangerLight,
    borderRadius: radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.3)',
  },
  disputedText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    ...shadows.card,
  },
});
