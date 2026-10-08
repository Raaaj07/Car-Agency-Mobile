import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { QrCode, CheckCircle2, IndianRupee } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { useRideStore } from '../../store/rideStore';
import { useAuthStore } from '../../store/authStore';
import { ridesApi } from '../../api/rides';
import { getApiError } from '../../api/client';
import { buildUpiPaymentUrl, isValidUpiId } from '../../utils/upi';
import { loadPayeeUpi, savePayeeUpi } from '../../lib/payeeUpi';

interface Props {
  onDone: () => void;
}

/**
 * Collect Payment (shown right after the driver completes a trip).
 *
 * The QR is derived from two things only: the driver's payee UPI ID and the
 * exact ride amount (fare + tip). The UPI ID normally comes from the driver's
 * profile (Profile tab → "Payment UPI ID"), so the QR appears instantly after
 * every trip. A driver who has not set one yet can enter it here — it is saved
 * to the profile too, so it only has to be typed once.
 *
 * After the rider pays, the driver taps "Amount Received" — that flag is what
 * the admin console shows.
 */
export const DriverPaymentScreen: React.FC<Props> = ({ onDone }) => {
  const navigation = useNavigation<any>();
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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Shown under the UPI row: a validation / "saved for this ride only" note.
  const [vpaNote, setVpaNote] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  // Restore the payee UPI ID from the profile (server truth, offline cache as
  // fallback). Runs on every focus, so an ID saved on the Profile tab while
  // this screen stayed in the stack shows up the moment the driver returns.
  const loadPayee = useCallback(async () => {
    const { vpa } = await loadPayeeUpi();
    if (vpa) {
      setSavedVpa(vpa);
      setVpaInput((current) => current || vpa);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void loadPayee();
    }, [loadPayee]),
  );

  const inputValid = isValidUpiId(vpaInput);
  const hasPayee = isValidUpiId(savedVpa);
  const showEditor = !hasPayee || editing;

  const saveVpa = async () => {
    const trimmed = vpaInput.trim();
    if (!isValidUpiId(trimmed)) {
      setVpaNote('Enter a valid UPI ID like name@bank');
      return;
    }
    setSaving(true);
    setVpaNote(undefined);
    const result = await savePayeeUpi(trimmed);
    setSaving(false);
    if (result.ok) {
      setSavedVpa(result.vpa);
      setVpaInput(result.vpa);
      setEditing(false);
      return;
    }
    // Collecting this fare must never be blocked by a profile-save problem
    // (offline, not approved yet…): the QR still works for THIS ride from the
    // local value — but be honest that it is not on the profile.
    setSavedVpa(trimmed);
    setEditing(false);
    setVpaNote(`Using this UPI ID for this ride only — it could not be saved to your profile (${result.error}).`);
  };

  // QR regenerates automatically whenever the ride amount or the UPI ID
  // changes — it is derived, never hand-built.
  const qrValue =
    hasPayee && amount > 0
      ? buildUpiPaymentUrl({
          vpa: savedVpa,
          payeeName: driverName?.trim() || 'Driver',
          amount,
          note: 'Vazhi ride fare',
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
                {!hasPayee
                  ? `Add your UPI ID below to generate the payment QR for ₹${amount.toFixed(2)}`
                  : 'The ride amount is not available yet. Go back and reopen this screen.'}
              </Text>
            </View>
          )}

          {hasPayee ? (
            <Text style={styles.qrHint}>
              Ask the rider to scan this code with GPay, PhonePe or Paytm — the amount is pre-filled.
            </Text>
          ) : null}

          {showEditor ? (
            <>
              <View style={styles.vpaRow}>
                <TextInput
                  style={styles.vpaInput}
                  value={vpaInput}
                  onChangeText={(t) => {
                    setVpaInput(t);
                    if (vpaNote) setVpaNote(undefined);
                  }}
                  placeholder="yourname@okhdfcbank"
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
                  loading={saving}
                  disabled={saving || !inputValid}
                />
              </View>
              {hasPayee ? (
                <Button
                  title="Cancel"
                  variant="ghost"
                  size="small"
                  onPress={() => {
                    setEditing(false);
                    setVpaInput(savedVpa);
                    setVpaNote(undefined);
                  }}
                />
              ) : null}
              <Text style={styles.payeeHint}>
                Saved to your profile, so you only enter it once. You can change it any time in Profile → Payment UPI ID.
              </Text>
            </>
          ) : (
            <View style={styles.payeeRow}>
              <Text style={styles.payeeText} numberOfLines={1}>
                Paying to: {savedVpa}
              </Text>
              <Button title="Change" variant="ghost" size="small" onPress={() => setEditing(true)} />
            </View>
          )}

          {vpaNote ? <Text style={styles.payeeError}>{vpaNote}</Text> : null}

          {!hasPayee ? (
            <Button
              title="Set it up in Profile"
              variant="ghost"
              size="small"
              onPress={() => navigation.navigate('ProfileTab')}
            />
          ) : null}
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
  payeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: 8,
  },
  payeeText: {
    ...typography.meta,
    fontSize: 12,
    color: colors.success,
    flex: 1,
  },
  payeeHint: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textMuted,
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
