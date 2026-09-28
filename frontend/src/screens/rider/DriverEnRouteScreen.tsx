import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Phone, MessageSquare, Clock, MapPin, KeyRound } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Avatar } from '../../components/primitives/Avatar';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';
import { useRideStore } from '../../store/rideStore';
import { useRideSocket } from '../../hooks/useSocket';
import { ridesApi } from '../../api/rides';

interface Props {
  onStartTrip: () => void;
  onCancelRide: () => void;
}

export const DriverEnRouteScreen: React.FC<Props> = ({ onStartTrip, onCancelRide }) => {
  const activeRide = useRideStore((state) => state.activeRide);
  const pickupOtp = activeRide?.pickupOtp;
  const pickupText = activeRide?.pickup?.address || 'Pickup Location';
  const dropText = activeRide?.dropoff?.address || 'Drop-off Location';
  const driverName = activeRide?.riderName ? 'Assigned Driver' : 'Rajesh Kumar';

  // Guard: ensure onStartTrip is called exactly once (socket + poll may both fire).
  const startedRef = useRef(false);
  const safeStartTrip = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStartTrip();
  };

  // Listen for real-time ride status update: when driver verifies OTP, status becomes in_progress
  useRideSocket(activeRide?.id, {
    onStatus: (event) => {
      if (event.status === 'in_progress') {
        safeStartTrip();
      }
    },
  });

  // Polling fallback to catch OTP verification in case of socket reconnection
  useEffect(() => {
    if (!activeRide?.id) return;
    const interval = setInterval(async () => {
      try {
        const current = await ridesApi.get(activeRide.id);
        if (current.status === 'in_progress') {
          safeStartTrip();
        }
      } catch {
        // Polling failure ignored
      }
    }, 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide?.id]);

  return (
    <View style={styles.container}>
      <MapPlaceholder
        showDriverPin
        driverEta="8 MIN"
        pickupText={pickupText}
        dropText={dropText}
      />

      {/* Floating Status Pill Header */}
      <View style={styles.statusPill}>
        <Clock size={16} color="#FFFFFF" />
        <Text style={styles.statusPillText}>Driver is on the way to your pickup</Text>
      </View>

      {/* Bottom Sheet Card */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        {/* Start OTP Code Box */}
        <View style={styles.otpBox}>
          <View style={styles.otpLeft}>
            <KeyRound size={20} color={colors.primary} />
            <View>
              <Text style={styles.otpLabel}>START RIDE OTP</Text>
              <Text style={styles.otpSubLabel}>Share with driver at pickup</Text>
            </View>
          </View>
          <Text style={styles.otpValue}>{pickupOtp ?? '----'}</Text>
        </View>

        <View style={styles.driverRow}>
          <Avatar name={driverName} rating={4.9} size={50} online />
          <View style={styles.driverMeta}>
            <Text style={styles.driverName}>{driverName}</Text>
            <Text style={styles.vehicleInfo}>White Maruti Dzire • KA 05 MN 4821</Text>
          </View>

          <View style={styles.contactGroup}>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: colors.successLight }]}>
              <Phone size={18} color={colors.success} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: '#EEF2FF' }]}>
              <MessageSquare size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.pickupCard}>
          <MapPin size={18} color={colors.success} />
          <View style={styles.pickupTextWrap}>
            <Text style={styles.pickupLabel}>PICKUP LOCATION</Text>
            <Text style={styles.pickupAddr} numberOfLines={1}>{pickupText}</Text>
          </View>
        </View>

        <View style={styles.btnRow}>
          <Button
            title="Cancel"
            onPress={onCancelRide}
            variant="outline"
            size="medium"
            style={styles.cancelBtn}
          />
          <Button
            title="Trip Started"
            onPress={onStartTrip}
            variant="primary"
            size="medium"
            style={styles.startBtn}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statusPill: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
    gap: 8,
    ...shadows.card,
  },
  statusPillText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    ...shadows.modal,
    gap: 14,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverMeta: {
    flex: 1,
  },
  driverName: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  vehicleInfo: {
    ...typography.meta,
    fontSize: 12,
  },
  contactGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  pickupTextWrap: {
    flex: 1,
  },
  pickupLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
  },
  pickupAddr: {
    ...typography.bodyBold,
    fontSize: 13,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
  },
  startBtn: {
    flex: 2,
  },
  otpBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(33, 27, 78, 0.15)',
  },
  otpLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  otpLabel: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.primary,
    letterSpacing: 1,
  },
  otpSubLabel: {
    ...typography.meta,
    fontSize: 10,
    color: colors.textMuted,
  },
  otpValue: {
    ...typography.heading,
    fontSize: 22,
    color: colors.primary,
    letterSpacing: 4,
  },
});
