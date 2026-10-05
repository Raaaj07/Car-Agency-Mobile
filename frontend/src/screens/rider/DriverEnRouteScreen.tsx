import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Phone, MessageSquare, Clock, MapPin, KeyRound } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Avatar } from '../../components/primitives/Avatar';
import { RealMapView } from '../../components/primitives/RealMapView';
import { useRideStore } from '../../store/rideStore';
import { useRideSocket } from '../../hooks/useSocket';
import { ridesApi } from '../../api/rides';
import { getRoute } from '../../api/mapbox';

interface Props {
  onStartTrip: () => void;
  onCancelRide: () => void;
  onRideCancelled?: (reason?: string) => void;
  onRideCompleted?: () => void;
}

// Friendly label for the raw vehicleType id (auto -> 'Auto', ...).
const VEHICLE_LABELS: Record<string, string> = {
  auto: 'Auto',
  mini: 'Mini',
  sedan: 'Sedan',
  suv: 'SUV',
};

export const DriverEnRouteScreen: React.FC<Props> = ({
  onStartTrip,
  onCancelRide,
  onRideCancelled,
  onRideCompleted,
}) => {
  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const pickupCoords = useRideStore((state) => state.pickupCoords);
  const dropoffCoords = useRideStore((state) => state.dropoffCoords);
  const pickupOtp = activeRide?.pickupOtp;
  const pickupText = activeRide?.pickup?.address || 'Pickup Location';
  const dropText = activeRide?.dropoff?.address || 'Drop-off Location';
  const driverInfo = activeRide?.driver ?? null;
  const driverName = driverInfo?.name?.trim() || 'Your driver';
  const vehicleLabel = (activeRide?.vehicleType && VEHICLE_LABELS[activeRide.vehicleType]) || '';
  const vehicleText =
    [vehicleLabel, driverInfo?.vehicleModel, driverInfo?.plateNumber]
      .filter((part): part is string => !!part && String(part).trim().length > 0)
      .join(' • ') || 'Vehicle details will be shared on arrival';
  const [route, setRoute] = useState<[number, number][] | undefined>(undefined);
  const [driverPosition, setDriverPosition] = useState<
    { lat: number; lng: number } | undefined
  >();
  // Measured bottom-sheet height so the map can pad the fit above it.
  const [sheetHeight, setSheetHeight] = useState(0);

  // Guard: ensure onStartTrip is called exactly once (socket + poll may both fire).
  const startedRef = useRef(false);
  const safeStartTrip = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStartTrip();
  };

  // Terminal transitions (completed / cancelled) fire exactly once.
  const terminalRef = useRef(false);
  const onRideCancelledRef = useRef(onRideCancelled);
  const onRideCompletedRef = useRef(onRideCompleted);
  // Latest-prop refs synced in an effect: writing .current during render trips
  // react-hooks/refs, and the only readers are async socket/poll handlers.
  useEffect(() => {
    onRideCancelledRef.current = onRideCancelled;
    onRideCompletedRef.current = onRideCompleted;
  });

  // Shared by the socket handler and the 3s polling fallback.
  const checkRideStatus = useCallback(async () => {
    const rideId = useRideStore.getState().activeRide?.id;
    if (!rideId) return;
    try {
      const current = await ridesApi.get(rideId);
      if (current.status === 'in_progress') {
        safeStartTrip();
      } else if (!terminalRef.current && current.status === 'cancelled') {
        terminalRef.current = true;
        setActiveRide(current);
        onRideCancelledRef.current?.(current.cancellationReason ?? undefined);
      } else if (!terminalRef.current && current.status === 'completed') {
        terminalRef.current = true;
        setActiveRide(current);
        onRideCompletedRef.current?.();
      }
    } catch {
      // Polling failure ignored
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActiveRide]);

  // Listen for real-time ride status update: OTP verified (in_progress),
  // or the ride ended (completed/cancelled — driver cancel, or stale sweep).
  useRideSocket(activeRide?.id, {
    onDriverLocation: (event) => {
      setDriverPosition({ lat: event.lat, lng: event.lng });
    },
    onStatus: (event) => {
      if (
        event.status === 'in_progress' ||
        event.status === 'cancelled' ||
        event.status === 'completed'
      ) {
        void checkRideStatus();
      }
    },
  });

  // Polling fallback to catch status changes in case of socket reconnection.
  // Keeps polling through in_progress (waiting for completion) and stops
  // after the first terminal state.
  useEffect(() => {
    if (!activeRide?.id) return;
    void checkRideStatus();
    const timer = setInterval(() => {
      if (terminalRef.current) {
        clearInterval(timer);
        return;
      }
      void checkRideStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeRide?.id, checkRideStatus]);

  // Road-following route for the fit-bounds map. Failures fall back to
  // fitting just the endpoints.
  useEffect(() => {
    let mounted = true;
    const pickup = pickupCoords ?? (activeRide?.pickup ? { lat: activeRide.pickup.lat, lng: activeRide.pickup.lng } : undefined);
    const dropoff = dropoffCoords ?? (activeRide?.dropoff ? { lat: activeRide.dropoff.lat, lng: activeRide.dropoff.lng } : undefined);
    if (!pickup || !dropoff) {
      // Async boundary — sync setState directly in the effect trips
      // react-hooks/set-state-in-effect; a microtask is invisible next to
      // the route fetch it guards.
      Promise.resolve().then(() => setRoute(undefined));
      return;
    }
    getRoute(pickup, dropoff)
      .then((result) => {
        if (mounted && result) setRoute(result.coordinates);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [pickupCoords, dropoffCoords, activeRide?.pickup, activeRide?.dropoff]);

  return (
    <View style={styles.container}>
      <RealMapView
        mode="tracking"
        pickup={pickupCoords ?? (activeRide?.pickup ? { lat: activeRide.pickup.lat, lng: activeRide.pickup.lng } : undefined)}
        dropoff={dropoffCoords ?? (activeRide?.dropoff ? { lat: activeRide.dropoff.lat, lng: activeRide.dropoff.lng } : undefined)}
        driverPosition={driverPosition}
        route={route}
        bottomPadding={sheetHeight}
      />

      {/* Floating Status Pill Header */}
      <View style={styles.statusPill}>
        <Clock size={16} color="#FFFFFF" />
        <Text style={styles.statusPillText}>Driver is on the way to your pickup</Text>
      </View>

      {/* Drop-off line under the map header (real address, no invented ETA) */}
      <View style={styles.dropPill}>
        <MapPin size={14} color={colors.primary} />
        <Text style={styles.dropPillText} numberOfLines={1}>{dropText}</Text>
      </View>

      {/* Bottom Sheet Card */}
      <View
        style={styles.bottomSheet}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
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
          <Avatar
            name={driverName}
            rating={driverInfo?.rating ?? undefined}
            uri={driverInfo?.avatar ?? undefined}
            size={50}
            online
          />
          <View style={styles.driverMeta}>
            <Text style={styles.driverName}>{driverName}</Text>
            <Text style={styles.vehicleInfo}>{vehicleText}</Text>
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
  dropPill: {
    position: 'absolute',
    top: 72,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    gap: 6,
    maxWidth: '90%',
    ...shadows.card,
  },
  dropPillText: {
    fontWeight: '700',
    fontSize: 12,
    color: colors.textPrimary,
    flexShrink: 1,
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
