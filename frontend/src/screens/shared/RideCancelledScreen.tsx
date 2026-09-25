import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { XCircle, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { useRideStore } from '../../store/rideStore';

interface Props {
  reason?: string;
  onBookNew?: () => void;
  onGoHome?: () => void;
}

export const RideCancelledScreen: React.FC<Props> = ({
  reason: propReason,
  onBookNew,
  onGoHome,
}) => {
  const storeReason = useRideStore((state) => state.cancellationReason);
  const displayReason = propReason || storeReason || 'Driver is taking too long to arrive';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Cancel Icon Header */}
        <View style={styles.headerBox}>
          <View style={styles.iconCircleOuter}>
            <View style={styles.iconCircleInner}>
              <XCircle size={44} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.title}>Ride Cancelled</Text>
          <Text style={styles.subtitle}>Your ride request has been cancelled successfully</Text>
        </View>

        {/* Cancellation Details Card */}
        <Card style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>CANCELLATION REASON</Text>
            <Text style={styles.reasonVal}>{displayReason}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.feeRow}>
            <ShieldCheck size={18} color={colors.success} />
            <Text style={styles.feeText}>
              Cancellation Fee Charged: <Text style={styles.feeAmount}>₹0.00</Text>
            </Text>
          </View>
        </Card>

        {/* Alternative Suggestion Banner */}
        <Card style={styles.suggestCard}>
          <Text style={styles.suggestTitle}>Need another ride right away?</Text>
          <Text style={styles.suggestSub}>Multiple cars are available nearby in your area.</Text>
        </Card>
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        {onBookNew && (
          <Button
            title="Book Another Ride"
            onPress={onBookNew}
            variant="primary"
            size="large"
            leftIcon={<RefreshCw size={18} color="#FFFFFF" />}
          />
        )}
        {onGoHome && (
          <Button
            title="Back to Home"
            onPress={onGoHome}
            variant="ghost"
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
    padding: 24,
    paddingBottom: 130,
    gap: 16,
  },
  headerBox: {
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 10,
  },
  iconCircleOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconCircleInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.heading,
    fontSize: 28,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    maxWidth: 280,
  },
  infoCard: {
    padding: 18,
  },
  infoRow: {},
  infoLabel: {
    ...typography.metaBold,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  reasonVal: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 14,
  },
  feeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feeText: {
    ...typography.body,
    fontSize: 13,
  },
  feeAmount: {
    color: colors.success,
    fontWeight: '700',
  },
  suggestCard: {
    padding: 16,
    backgroundColor: '#EEF2FF',
    borderColor: 'rgba(33, 27, 78, 0.15)',
  },
  suggestTitle: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.primary,
  },
  suggestSub: {
    ...typography.meta,
    fontSize: 12,
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
