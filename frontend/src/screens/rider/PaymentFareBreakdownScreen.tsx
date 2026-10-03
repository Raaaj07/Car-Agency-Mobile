import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { CheckCircle, Clock, Download } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Header } from '../../components/primitives/Header';
import { useRideStore } from '../../store/rideStore';
import { ridesApi } from '../../api/rides';

interface Props {
  onBack?: () => void;
  onDone?: () => void;
}

export const PaymentFareBreakdownScreen: React.FC<Props> = ({ onBack, onDone }) => {
  const selectedVehicle = useRideStore((state) => state.selectedVehicle);
  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const promoCode = useRideStore((state) => state.promoCode);
  const estimateBreakdown = useRideStore((state) => state.getFareBreakdown)();
  // Server-computed fare (final, post-completion) wins over the booking estimate.
  const breakdown = activeRide?.fareBreakdown ?? estimateBreakdown;
  const tip = Number(activeRide?.tipAmount ?? 0);
  const isPaid = activeRide?.paymentStatus === 'paid';
  const amount = Number(breakdown?.total ?? 0) + tip;
  const vehicleName = selectedVehicle?.name ?? activeRide?.vehicleType ?? 'your ride';

  // The rider pays the UPI QR shown on the driver's phone; the driver then
  // taps "Amount Received". Poll until that flag flips so this screen shows
  // the real state instead of an assumed "successful".
  useEffect(() => {
    if (!activeRide?.id || activeRide.paymentStatus === 'paid') return;
    const rideId = activeRide.id;
    const timer = setInterval(() => {
      ridesApi
        .get(rideId)
        .then((fresh) => {
          if (fresh?.paymentStatus) setActiveRide(fresh);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [activeRide?.id, activeRide?.paymentStatus, setActiveRide]);

  return (
    <View style={styles.container}>
      {onBack && <Header title="Fare Breakdown" onBack={onBack} />}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Total Amount Header Card */}
        <Card style={styles.totalHeaderCard}>
          <View style={[styles.statusBadge, !isPaid && styles.statusBadgePending]}>
            {isPaid ? (
              <CheckCircle size={16} color={colors.success} />
            ) : (
              <Clock size={16} color={colors.warning} />
            )}
            <Text style={[styles.statusText, !isPaid && styles.statusTextPending]}>
              {isPaid ? 'PAYMENT RECEIVED' : 'AWAITING PAYMENT'}
            </Text>
          </View>
          <Text style={styles.totalAmount}>₹{amount.toFixed(2)}</Text>
          <Text style={styles.paymentMethodText}>
            {isPaid
              ? `Paid via UPI • ${vehicleName}`
              : "Pay by scanning the UPI QR on your driver's app — GPay, PhonePe or Paytm"}
          </Text>
        </Card>

        {/* Itemized Line Items */}
        <Card style={styles.breakdownCard}>
          <Text style={styles.cardSectionTitle}>ITEMIZED RECEIPT ({vehicleName})</Text>

          <View style={styles.lineRow}>
            <Text style={styles.lineLabel}>Base Fare (Includes 5 km)</Text>
            <Text style={styles.lineValue}>₹{Number(breakdown?.baseFare ?? 0).toFixed(2)}</Text>
          </View>

          <View style={styles.lineRow}>
            <Text style={styles.lineLabel}>Distance Charge</Text>
            <Text style={styles.lineValue}>₹{Number(breakdown?.distanceFare ?? 0).toFixed(2)}</Text>
          </View>

          <View style={styles.lineRow}>
            <Text style={styles.lineLabel}>Time Charge</Text>
            <Text style={styles.lineValue}>₹{Number(breakdown?.timeCharge ?? 0).toFixed(2)}</Text>
          </View>

          <View style={styles.lineRow}>
            <Text style={styles.lineLabel}>Toll & Airport Parking</Text>
            <Text style={styles.lineValue}>₹{Number(breakdown?.tollFee ?? 0).toFixed(2)}</Text>
          </View>

          <View style={styles.lineRow}>
            <Text style={styles.lineLabel}>GST & Govt Taxes (5%)</Text>
            <Text style={styles.lineValue}>₹{Number(breakdown?.taxes ?? 0).toFixed(2)}</Text>
          </View>

          {Number(breakdown?.discount ?? 0) > 0 && (
            <View style={[styles.lineRow, styles.discountRow]}>
              <Text style={styles.discountLabel}>
                Promo Discount{promoCode ? ` (${promoCode})` : ''}
              </Text>
              <Text style={styles.discountValue}>-₹{Number(breakdown?.discount).toFixed(2)}</Text>
            </View>
          )}

          {tip > 0 && (
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>Driver Tip</Text>
              <Text style={styles.lineValue}>₹{tip.toFixed(2)}</Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.lineRowTotal}>
            <Text style={styles.totalLabel}>{isPaid ? 'Final Amount Paid' : 'Amount to Pay'}</Text>
            <Text style={styles.totalVal}>₹{amount.toFixed(2)}</Text>
          </View>
        </Card>

        {/* Download Receipt Button */}
        <TouchableOpacity style={styles.downloadBtn}>
          <Download size={18} color={colors.primary} />
          <Text style={styles.downloadText}>Download Invoice PDF</Text>
        </TouchableOpacity>
      </ScrollView>

      {onDone && (
        <View style={styles.footer}>
          <Button title="Back to Home" onPress={onDone} variant="primary" size="large" />
        </View>
      )}
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
  totalHeaderCard: {
    padding: 24,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    gap: 4,
    marginBottom: 10,
  },
  statusText: {
    ...typography.metaBold,
    fontSize: 10,
    color: colors.success,
  },
  statusBadgePending: {
    backgroundColor: colors.warningLight,
  },
  statusTextPending: {
    color: colors.warning,
  },
  totalAmount: {
    ...typography.heading,
    fontSize: 34,
    color: colors.accent,
  },
  paymentMethodText: {
    ...typography.meta,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
  },
  breakdownCard: {
    padding: 18,
  },
  cardSectionTitle: {
    ...typography.metaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 14,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  lineLabel: {
    ...typography.body,
    fontSize: 13,
  },
  lineValue: {
    ...typography.bodyBold,
    fontSize: 13,
  },
  discountRow: {
    marginTop: 4,
  },
  discountLabel: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.success,
  },
  discountValue: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.success,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 12,
  },
  lineRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  totalVal: {
    ...typography.heading,
    fontSize: 20,
    color: colors.primary,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  downloadText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.primary,
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
