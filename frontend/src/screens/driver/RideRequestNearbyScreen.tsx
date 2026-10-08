import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { X, Check } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { RealMapView } from '../../components/primitives/RealMapView';
import { useRideStore } from '../../store/rideStore';

interface Props {
  onAccept: () => void | Promise<void>;
  onDecline: () => void;
  /** Countdown reached 0 with no action: release the offer silently (no error UI). */
  onExpire: () => void;
}

const VEHICLE_LABELS: Record<string, string> = {
  auto: 'Vazhi Auto',
  mini: 'Economy Mini',
  sedan: 'Comfort Sedan',
  suv: 'Premium SUV',
};

export const RideRequestNearbyScreen: React.FC<Props> = ({ onAccept, onDecline, onExpire }) => {
  const activeRide = useRideStore((state) => state.activeRide);
  const isFocused = useIsFocused();
  const [seconds, setSeconds] = useState<number>(activeRide?.expiresInSeconds ?? 15);
  // Set the instant the driver taps Accept/Decline (or the timer expires).
  // The old countdown kept ticking while the accept request was in flight and
  // after navigating on, then fired onDecline against an ALREADY-ACCEPTED ride
  // ("Nothing to decline") and popped the trip screen — the "auto cancel" bug.
  const handledRef = useRef(false);
  // Instant visual feedback the moment Accept is tapped: the button shows a
  // spinner and both buttons lock. Without it the screen looked frozen for the
  // whole network round trip and drivers kept tapping. Never reset: the
  // navigator leaves this screen on success AND on failure.
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    // Async boundary — sync setState directly in the effect trips
    // react-hooks/set-state-in-effect; a microtask is invisible next to the
    // 1-second countdown ticks below. Resets when a new offer arrives.
    handledRef.current = false;
    Promise.resolve().then(() => {
      setSeconds(activeRide?.expiresInSeconds ?? 15);
      setAccepting(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset keyed on offer id, not every field change
  }, [activeRide?.id]);

  // Always-fresh callbacks for the countdown (exhaustive-deps): adding them
  // to the interval's deps would restart the timer on every parent re-render,
  // so the effect reads refs instead.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    // Only count down while this screen is the visible one and the driver has
    // not acted. A screen left mounted underneath the trip screen must never
    // fire the expiry.
    if (!isFocused || handledRef.current) return;
    if (seconds <= 0) {
      handledRef.current = true;
      onExpireRef.current();
      return;
    }
    const timer = setInterval(() => setSeconds((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [seconds, isFocused]);

  const handleAccept = () => {
    if (handledRef.current) return;
    handledRef.current = true;
    setAccepting(true);
    void onAccept();
  };
  const handleDecline = () => {
    if (handledRef.current) return;
    handledRef.current = true;
    onDecline();
  };

  const vehicleLabel = activeRide?.vehicleType
    ? VEHICLE_LABELS[activeRide.vehicleType] ?? activeRide.vehicleType
    : 'Ride';
  const fareTotal = activeRide?.fareBreakdown?.total;

  return (
    <View style={styles.container}>
      <RealMapView mode="picker" pickup={activeRide?.pickup} dropoff={activeRide?.dropoff} />

      {/* Countdown Ring Header */}
      <View style={styles.timerHeader}>
        <View style={styles.timerCircle}>
          <Text style={styles.timerText}>{seconds}</Text>
        </View>
        <Text style={styles.timerSubText}>seconds to accept request</Text>
      </View>

      {/* Incoming Request Bottom Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.fareRow}>
          <View>
            <Text style={styles.estLabel}>ESTIMATED FARE</Text>
            <Text style={styles.fareAmount}>{fareTotal != null ? `₹${fareTotal.toFixed(2)}` : '—'}</Text>
          </View>

          <View style={styles.categoryPill}>
            <Text style={styles.categoryText}>{vehicleLabel}</Text>
          </View>
        </View>

        {/* The backend's ride:request event carries the rider's first name
            and profile photo (see toDriverView / offer payload). */}
        <Card style={styles.riderCard}>
          <View style={styles.riderRow}>
            <Avatar name={activeRide?.riderName ?? 'Rider'} uri={activeRide?.riderAvatar ?? undefined} size={48} />
            <View style={styles.riderMeta}>
              <Text style={styles.riderName}>{activeRide?.riderName ?? 'Rider'}</Text>
              <Text style={styles.riderSub}>
                {activeRide?.distanceKm ? `${activeRide.distanceKm} km trip` : 'Trip details loading…'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Pickup & Drop Details */}
        <View style={styles.routeDetails}>
          <View style={styles.pointRow}>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointLabel}>PICKUP</Text>
              <Text style={styles.pointVal}>{activeRide?.pickup?.address ?? 'Fetching pickup location…'}</Text>
            </View>
          </View>

          <View style={styles.routeLine} />

          <View style={styles.pointRow}>
            <View style={[styles.dot, { backgroundColor: colors.danger }]} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointLabel}>DROP OFF</Text>
              <Text style={styles.pointVal}>{activeRide?.dropoff?.address ?? 'Fetching drop location…'}</Text>
            </View>
          </View>
        </View>

        {/* Accept / Decline Action Buttons */}
        <View style={styles.btnRow}>
          <Button
            title="Decline"
            onPress={handleDecline}
            variant="danger"
            size="large"
            disabled={accepting}
            style={styles.declineBtn}
            leftIcon={<X size={20} color="#FFFFFF" />}
          />
          <Button
            title="Accept Ride"
            onPress={handleAccept}
            variant="success"
            size="large"
            loading={accepting}
            style={styles.acceptBtn}
            leftIcon={<Check size={20} color="#FFFFFF" />}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  timerHeader: {
    position: 'absolute', top: 20, alignSelf: 'center', alignItems: 'center',
    backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: radii.pill, flexDirection: 'row', gap: 10, ...shadows.card,
  },
  timerCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  timerText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  timerSubText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, ...shadows.modal, gap: 14,
  },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  estLabel: { ...typography.metaBold, fontSize: 10, color: colors.textMuted, letterSpacing: 1 },
  fareAmount: { ...typography.heading, fontSize: 30, color: colors.accent },
  categoryPill: { backgroundColor: '#EEF2FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill },
  categoryText: { ...typography.metaBold, color: colors.primary },
  riderCard: { padding: 14 },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  riderMeta: { flex: 1 },
  riderName: { ...typography.cardTitle, fontSize: 16 },
  riderSub: { ...typography.meta, fontSize: 12 },
  routeDetails: { backgroundColor: '#F8FAFC', padding: 14, borderRadius: radii.card, borderWidth: 1, borderColor: '#E5E7EB' },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pointTextWrap: { flex: 1 },
  pointLabel: { ...typography.metaBold, fontSize: 9, color: colors.textMuted },
  pointVal: { ...typography.bodyBold, fontSize: 13 },
  routeLine: { width: 2, height: 18, backgroundColor: colors.border, marginLeft: 4, marginVertical: 4 },
  btnRow: { flexDirection: 'row', gap: 12 },
  declineBtn: { flex: 1 },
  acceptBtn: { flex: 2 },
});