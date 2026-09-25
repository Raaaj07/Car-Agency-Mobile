import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { AlertTriangle, Check, ShieldAlert } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Header } from '../../components/primitives/Header';
import { useRideStore } from '../../store/rideStore';

interface Props {
  onBack?: () => void;
  onConfirmCancel?: (reason: string) => void;
}

const reasons = [
  'Driver is taking too long to arrive',
  'Changed my mind / No longer needed',
  'Selected wrong pickup/dropoff location',
  'Driver asked me to cancel the trip',
  'Booked another mode of transport',
];

export const CancelRideConfirmationScreen: React.FC<Props> = ({ onBack, onConfirmCancel }) => {
  const storeReason = useRideStore((state) => state.cancellationReason);
  const setCancellationReason = useRideStore((state) => state.setCancellationReason);
  const [selectedReason, setSelectedReason] = useState<string>(storeReason || reasons[0]);

  const handleConfirm = () => {
    setCancellationReason(selectedReason);
    if (onConfirmCancel) {
      onConfirmCancel(selectedReason);
    }
  };

  return (
    <View style={styles.container}>
      {onBack && <Header title="Cancel Ride" onBack={onBack} />}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Warning Alert Banner */}
        <View style={styles.warningBanner}>
          <AlertTriangle size={24} color={colors.danger} />
          <View style={styles.warningTextWrap}>
            <Text style={styles.warningTitle}>Are you sure you want to cancel?</Text>
            <Text style={styles.warningSub}>Your driver is already en route to your location.</Text>
          </View>
        </View>

        {/* Cancellation Reason List */}
        <Card style={styles.reasonsCard}>
          <Text style={styles.cardHeaderTitle}>SELECT CANCELLATION REASON</Text>

          {reasons.map((reason) => {
            const isSelected = selectedReason === reason;
            return (
              <TouchableOpacity
                key={reason}
                style={styles.reasonRow}
                onPress={() => setSelectedReason(reason)}
                activeOpacity={0.7}
              >
                <View style={[styles.radio, isSelected && styles.radioActive]}>
                  {isSelected && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                </View>
                <Text style={[styles.reasonText, isSelected && styles.reasonTextActive]}>
                  {reason}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Card>

        {/* Policy Box */}
        <View style={styles.policyBox}>
          <ShieldAlert size={16} color={colors.textSecondary} />
          <Text style={styles.policyText}>
            No cancellation fee will be charged for this trip (Cancelled within 2 minutes).
          </Text>
        </View>
      </ScrollView>

      {/* Footer Action Buttons */}
      <View style={styles.footer}>
        <Button
          title="Confirm Cancellation"
          onPress={handleConfirm}
          variant="danger"
          size="large"
        />
        {onBack && (
          <Button
            title="Keep My Ride"
            onPress={onBack}
            variant="outline"
            size="medium"
          />
        )}
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
    paddingBottom: 140,
    gap: 16,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    padding: 16,
    borderRadius: radii.card,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  warningTextWrap: {
    flex: 1,
  },
  warningTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    color: colors.danger,
  },
  warningSub: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textPrimary,
  },
  reasonsCard: {
    padding: 18,
  },
  cardHeaderTitle: {
    ...typography.metaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 14,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: 12,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  reasonText: {
    ...typography.body,
    fontSize: 14,
    flex: 1,
  },
  reasonTextActive: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  policyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  policyText: {
    ...typography.meta,
    fontSize: 12,
    flex: 1,
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
    gap: 10,
    ...shadows.card,
  },
});
