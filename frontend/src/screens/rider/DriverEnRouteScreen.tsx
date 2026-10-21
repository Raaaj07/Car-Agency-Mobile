import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Phone, MessageSquare, Clock, MapPin, KeyRound, WifiOff } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Avatar } from '../../components/primitives/Avatar';
import { RealMapView } from '../../components/primitives/RealMapView';
import { MapRecenterButtons } from '../../components/primitives/MapRecenterButtons';
import { useRideStore } from '../../store/rideStore';
import { useRideSocket } from '../../hooks/useSocket';
import { useDriverRoute } from '../../hooks/useDriverRoute';
import { ridesApi } from '../../api/rides';
import { formatDistance } from '../../utils/distance';
import { usePreventBack, useRequireActiveRide } from '../../navigation/navHelpers';

/** No `driver:location` for this long ⇒ the car position is stale. */
const DRIVER_STALE_MS = 20_000;
/** How often staleness is re-checked while waiting for a fix. */
const STALE_CHECK_MS = 5_000;

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
  // D2: back must never reveal the booking form while the driver is en
  // route — swallow it ("Cancel" below is the way out).
  usePreventBack(() => {});
  // D4: if the ride vanished under this screen, go home — never a dead map.
  useRequireActiveRide();
  const insets = useSafeAreaInsets();
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
  const [driverPosition, setDriverPosition] = useState<
    { lat: number; lng: number } | undefined
  >(() => (driverInfo?.location ? { lat: driverInfo.location.lat, lng: driverInfo.location.lng } : undefined));
  // Measured bottom-sheet height so the map can pad the fit above it.
  const [sheetHeight, setSheetHeight] = useState(0);
  // Driver's live heading relayed over the socket (undefined → the car marker
  // derives it from the direction of movement).
  const [driverHeading, setDriverHeading] = useState<number | undefined>(undefined);
  // Camera mode: off = whole picture (driver + pickup + route) and free look,
  // on = locked onto the driver.
  const [followDriver, setFollowDriver] = useState(false);
  const [recenterNonce, setRecenterNonce] = useState(0);
  // True when no `driver:location` has arrived for DRIVER_STALE_MS.
  const [driverStale, setDriverStale] = useState(false);
  // Local receive time of the last fix (0 = none yet). Seeded on mount (see
  // the effect below) so a dead socket right after mount still dims the car.
  const lastFixAtRef = useRef<number>(0);

  const pickup = pickupCoords ??
    (activeRide?.pickup
      ? { lat: activeRide.pickup.lat, lng: activeRide.pickup.lng }
      : undefined);

  // Live road route: driver → pickup, throttled to one Directions call per
  // 20 s inside the hook (never on every GPS fix). The last good route and
  // ETA stay on screen if a call fails.
  const { route, etaSeconds, distanceMeters } = useDriverRoute({
    driverPosition,
    target: pickup,
    enabled: activeRide?.status !== 'cancelled' && activeRide?.status !== 'completed',
  });

  const distanceLabel = formatDistance(
    distanceMeters != null ? distanceMeters / 1000 : null,
  );
  const etaLabel =
    etaSeconds == null
      ? null
      : etaSeconds < 60
        ? 'Arriving now'
        : `Arriving in ${Math.max(1, Math.round(etaSeconds / 60))} min${
            distanceLabel ? ` · ${distanceLabel}` : ''
          }`;
  // Staleness wins over the ETA so the rider knows the number is frozen.
  const statusText =
    driverStale && driverPosition
      ? 'Reconnecting to driver…'
      : etaLabel ?? 'Driver is on the way to your pickup';

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
      setDriverHeading(event.heading);
      // Local receive time: authoritative for staleness even if the server's
      // `at` is a little off our clock.
      lastFixAtRef.current = Date.now();
      setDriverStale(false);
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

  // Stale fix watchdog: if the socket goes quiet (driver tunnel, network drop)
  // dim the car and tell the rider we're reconnecting; any new fix clears it.
  useEffect(() => {
    // Start the clock at mount: a position that came with the ride payload is
    // only trusted until the first live fix (or 20 s, whichever is sooner).
    lastFixAtRef.current = Date.now();
    const timer = setInterval(() => {
      const last = lastFixAtRef.current;
      if (last === 0) return;
      if (Date.now() - last >= DRIVER_STALE_MS) setDriverStale(true);
    }, STALE_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  // "Locate driver": recenter on the car (zoom 15.5, via recenterTo) and
  // re-enable follow so it stays centred.
  const locateDriver = useCallback(() => {
    if (!driverPosition) return;
    setFollowDriver(true);
    setRecenterNonce((n) => n + 1);
  }, [driverPosition]);

  const toggleFollow = useCallback(() => {
    if (followDriver) {
      setFollowDriver(false);
      return;
    }
    // Turning follow on also recenters immediately (next fix is up to 4 s out).
    setFollowDriver(true);
    setRecenterNonce((n) => n + 1);
  }, [followDriver]);

  // A pan/zoom means free look: stop following until Locate/Follow is tapped.
  const handleCenterGestureStart = useCallback(() => setFollowDriver(false), []);

  return (
    <View style={styles.container}>
      <RealMapView
        mode="tracking"
        pickup={pickup}
        driverPosition={driverPosition}
        driverHeading={driverHeading}
        route={route}
        bottomPadding={sheetHeight}
        followDriver={followDriver}
        driverStale={driverStale}
        recenterTo={
          driverPosition
            ? { lat: driverPosition.lat, lng: driverPosition.lng, nonce: recenterNonce }
            : undefined
        }
        onCenterGestureStart={handleCenterGestureStart}
      />

      {/* Floating Status Pill Header — ETA once the route exists */}
      <View style={[styles.statusPill, driverStale && styles.statusPillStale, { top: 20 + insets.top }]}>
        {driverStale ? (
          <WifiOff size={16} color="#FFFFFF" />
        ) : (
          <Clock size={16} color="#FFFFFF" />
        )}
        <Text style={styles.statusPillText} numberOfLines={1}>{statusText}</Text>
      </View>

      {/* Drop-off line under the map header (real address, no invented ETA) */}
      <View style={[styles.dropPill, { top: 72 + insets.top }]}>
        <MapPin size={14} color={colors.primary} />
        <Text style={styles.dropPillText} numberOfLines={1}>{dropText}</Text>
      </View>

      {/* Locate driver + Follow, floating above the bottom sheet */}
      {driverPosition && (
        <MapRecenterButtons
          onLocate={locateDriver}
          followOn={followDriver}
          onToggleFollow={toggleFollow}
          bottomOffset={sheetHeight}
        />
      )}

      {/* Bottom Sheet Card */}
      <View
        style={[styles.bottomSheet, { paddingBottom: 20 + insets.bottom }]}
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
            onPress={() => {
              // D5: only the server starts the trip (the driver enters the
              // pickup OTP). Don't jump to the trip map on a local tap.
              if (useRideStore.getState().activeRide?.status === 'in_progress') {
                safeStartTrip();
              } else {
                Alert.alert(
                  'Trip not started yet',
                  'The trip begins once the driver enters your pickup OTP.',
                );
              }
            }}
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
    maxWidth: '92%',
    ...shadows.card,
  },
  statusPillStale: {
    backgroundColor: colors.warning,
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
