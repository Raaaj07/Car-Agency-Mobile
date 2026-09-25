import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { CreditCard, Tag, ShieldCheck, ChevronRight, Check } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Header } from '../../components/primitives/Header';
import { useRideStore } from '../../store/rideStore';

interface Props {
  onBack?: () => void;
  onConfirmRide?: () => void;
}

export const RideDetailsScreen: React.FC<Props> = ({ onBack, onConfirmRide }) => {
  const selectedVehicle = useRideStore((state) => state.selectedVehicle);
  const pickupAddress = useRideStore((state) => state.pickupAddress);
  const dropoffAddress = useRideStore((state) => state.dropoffAddress);
  const promoCode = useRideStore((state) => state.promoCode);
  const discountAmount = useRideStore((state) => state.discountAmount);
  const breakdown = useRideStore((state) => state.getFareBreakdown)();

  return (
    <View style={styles.container}>
      {onBack && <Header title="Ride Summary" onBack={onBack} />}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Selected Vehicle Overview */}
        <Card style={styles.vehicleSummaryCard}>
          <View style={styles.vehicleRow}>
            <Text style={styles.vehicleEmoji}>{selectedVehicle.icon}</Text>
            <View style={styles.vehicleInfo}>
              <Text style={styles.vehicleTitle}>{selectedVehicle.name}</Text>
              <Text style={styles.vehicleSub}>{selectedVehicle.type}</Text>
            </View>
            <Text style={styles.totalPrice}>₹{breakdown.total}</Text>
          </View>
        </Card>

        {/* Pickup & Drop Route Summary */}
        <Card style={styles.routeCard}>
          <Text style={styles.sectionTitle}>TRIP ROUTE</Text>
          <View style={styles.routeRow}>
            <View style={styles.dotsColumn}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <View style={styles.line} />
              <View style={[styles.dot, { backgroundColor: colors.danger }]} />
            </View>

            <View style={styles.addressCol}>
              <View style={styles.addrItem}>
                <Text style={styles.addrLabel}>PICKUP LOCATION</Text>
                <Text style={styles.addrText}>{pickupAddress}</Text>
              </View>
              <View style={styles.addrItem}>
                <Text style={styles.addrLabel}>DROP-OFF LOCATION</Text>
                <Text style={styles.addrText}>{dropoffAddress}</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Payment Method Selector */}
        <Card style={styles.cardSection}>
          <Text style={styles.sectionTitle}>PAYMENT METHOD</Text>
          <TouchableOpacity style={styles.paymentRow}>
            <View style={styles.paymentIcon}>
              <CreditCard size={20} color={colors.primary} />
            </View>
            <View style={styles.paymentInfo}>
              <Text style={styles.paymentName}>UPI / Cash on Delivery</Text>
              <Text style={styles.paymentSub}>Pay driver directly after ride</Text>
            </View>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </Card>

        {/* Promo Code Card */}
        <Card style={styles.cardSection}>
          <Text style={styles.sectionTitle}>PROMO CODE</Text>
          <View style={styles.promoInputRow}>
            <Tag size={20} color={colors.accent} style={{ marginRight: 8 }} />
            <Text style={styles.promoCodeText}>{promoCode || 'VAZHI20'}</Text>
            <View style={styles.appliedBadge}>
              <Check size={14} color={colors.success} />
              <Text style={styles.appliedText}>₹{discountAmount} Saved</Text>
            </View>
          </View>
        </Card>

        {/* Safety Banner */}
        <View style={styles.safetyBox}>
          <ShieldCheck size={20} color={colors.success} />
          <Text style={styles.safetyText}>
            All Vazhi rides are protected with 24/7 Safety Helpline & Live Ride Tracking.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Confirm Action */}
      {onConfirmRide && (
        <View style={styles.footer}>
          <View style={styles.fareRow}>
            <View>
              <Text style={styles.fareLabel}>Total Fare</Text>
              <Text style={styles.fareSub}>Includes taxes & fees</Text>
            </View>
            <Text style={styles.fareAmount}>₹{breakdown.total}</Text>
          </View>

          <Button title="Confirm Booking" onPress={onConfirmRide} variant="primary" size="large" />
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
    paddingBottom: 130,
    gap: 16,
  },
  vehicleSummaryCard: {
    padding: 16,
    backgroundColor: colors.primary,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleTitle: {
    ...typography.cardTitle,
    color: '#FFFFFF',
  },
  vehicleSub: {
    ...typography.meta,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  totalPrice: {
    ...typography.heading,
    color: colors.accent,
  },
  routeCard: {
    padding: 16,
  },
  sectionTitle: {
    ...typography.metaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 12,
  },
  routeRow: {
    flexDirection: 'row',
  },
  dotsColumn: {
    alignItems: 'center',
    marginRight: 12,
    paddingVertical: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  line: {
    width: 2,
    height: 38,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  addressCol: {
    flex: 1,
    gap: 12,
  },
  addrItem: {},
  addrLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
  },
  addrText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  cardSection: {
    padding: 16,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  paymentInfo: {
    flex: 1,
  },
  paymentName: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  paymentSub: {
    ...typography.meta,
    fontSize: 12,
  },
  promoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF6ED',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  promoCodeText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.accent,
    flex: 1,
  },
  appliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    gap: 4,
  },
  appliedText: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.success,
  },
  safetyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    padding: 14,
    borderRadius: radii.card,
    gap: 10,
  },
  safetyText: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textPrimary,
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
    gap: 14,
    ...shadows.card,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fareLabel: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  fareSub: {
    ...typography.meta,
    fontSize: 11,
  },
  fareAmount: {
    ...typography.heading,
    fontSize: 24,
    color: colors.primary,
  },
});
