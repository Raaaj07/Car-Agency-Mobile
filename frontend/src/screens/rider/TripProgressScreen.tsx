import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Share,
} from 'react-native';

import {
  ShieldAlert,
  Share2,
  MapPin,
  Clock,
  WifiOff,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  colors,
  radii,
  typography,
  shadows,
} from '../../theme/theme';

import { Button } from '../../components/primitives/Button';
import { RealMapView } from '../../components/primitives/RealMapView';
import { MapRecenterButtons } from '../../components/primitives/MapRecenterButtons';
import { useResyncOnForeground, useRideSocket } from '../../hooks/useSocket';
import { useDriverRoute } from '../../hooks/useDriverRoute';
import { useRideStore } from '../../store/rideStore';
import { ridesApi } from '../../api/rides';
import { safetyApi } from '../../api/safety';
import { getApiError } from '../../api/client';
import { formatDistance } from '../../utils/distance';
import { usePreventBack, useRequireActiveRide } from '../../navigation/navHelpers';

/** No `driver:location` for this long ⇒ the car position is stale. */
const DRIVER_STALE_MS = 20_000;
/** How often staleness is re-checked while waiting for a fix. */
const STALE_CHECK_MS = 5_000;

interface Props {
  onCompleteTrip: () => void;
  onCancelRide?: () => void;
  onRideCancelled?: (reason?: string) => void;
}

export const TripProgressScreen: React.FC<Props> = ({
  onCompleteTrip,
  onCancelRide,
  onRideCancelled,
}) => {
  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const dropoffCoords = useRideStore((state) => state.dropoffCoords);
  const storeDropoffAddress = useRideStore((state) => state.dropoffAddress);
  const dropoffAddress = activeRide?.dropoff?.address || storeDropoffAddress || 'Drop-off';

  // Seeded from the ride payload so the car is on the map before the first
  // live fix (the socket tick is up to 4 s behind).
  const [driverPosition, setDriverPosition] = useState<
    { lat: number; lng: number } | undefined
  >(() =>
    activeRide?.driver?.location
      ? { lat: activeRide.driver.location.lat, lng: activeRide.driver.location.lng }
      : undefined,
  );
  // Driver's live heading relayed over the socket (undefined → the car marker
  // derives it from the direction of movement).
  const [driverHeading, setDriverHeading] = useState<number | undefined>(undefined);
  // Measured bottom-sheet height so floating controls clear it.
  const [sheetHeight, setSheetHeight] = useState(0);
  const [sharing, setSharing] = useState(false);
  // In-trip the camera follows the car by default (existing behaviour); a pan
  // drops to free look until Locate/Follow is tapped.
  const [followDriver, setFollowDriver] = useState(true);
  const [recenterNonce, setRecenterNonce] = useState(0);
  // True when no `driver:location` has arrived for DRIVER_STALE_MS.
  const [driverStale, setDriverStale] = useState(false);
  // Local receive time of the last fix (0 = none yet), started on mount.
  const lastFixAtRef = useRef<number>(0);

  const dropoff = dropoffCoords ??
    (activeRide?.dropoff
      ? { lat: activeRide.dropoff.lat, lng: activeRide.dropoff.lng }
      : undefined);

  // Live road route: driver → drop-off, throttled to one Directions call per
  // 20 s inside the hook (never on every GPS fix). The last good route and
  // ETA stay on screen if a call fails.
  const { route, etaSeconds, distanceMeters } = useDriverRoute({
    driverPosition,
    target: dropoff,
    enabled: activeRide?.status !== 'completed' && activeRide?.status !== 'cancelled',
  });

  const distanceLabel = formatDistance(
    distanceMeters != null ? distanceMeters / 1000 : null,
  );
  const etaLabel =
    etaSeconds == null
      ? null
      : etaSeconds < 60
        ? 'Reaching drop now'
        : `Reaching drop in ${Math.max(1, Math.round(etaSeconds / 60))} min${
            distanceLabel ? ` · ${distanceLabel}` : ''
          }`;
  // Staleness wins over the ETA so the rider knows the number is frozen.
  const etaText =
    driverStale && driverPosition ? 'Reconnecting to driver…' : etaLabel;

  // D2: an in-progress trip must never reveal the booking form — swallow back
  // (cancel/emergency are the explicit ways out of this screen).
  usePreventBack(() => {});
  // D4: if the ride vanished under this screen, go home — never a dead map.
  useRequireActiveRide();
  const insets = useSafeAreaInsets();

  // Terminal transition (completed/cancelled) must fire exactly once, no
  // matter how many sources (socket + 3s poll) detect it.
  const terminalRef = useRef(false);
  const onCompleteRef = useRef(onCompleteTrip);
  const onRideCancelledRef = useRef(onRideCancelled);
  // Latest-prop refs synced in an effect: writing .current during render trips
  // react-hooks/refs, and the only readers are async socket/poll handlers.
  useEffect(() => {
    onCompleteRef.current = onCompleteTrip;
    onRideCancelledRef.current = onRideCancelled;
  });

  const checkTerminalStatus = useCallback(async () => {
    if (terminalRef.current) return;
    const rideId = useRideStore.getState().activeRide?.id;
    if (!rideId) return;
    try {
      const ride = await ridesApi.get(rideId);
      if (terminalRef.current) return;
      if (ride.status === 'completed') {
        terminalRef.current = true;
        setActiveRide(ride);
        onCompleteRef.current();
      } else if (ride.status === 'cancelled') {
        terminalRef.current = true;
        setActiveRide(ride);
        onRideCancelledRef.current?.(ride.cancellationReason ?? undefined);
      }
    } catch {
      // Polling failure ignored — the socket path retries next tick.
    }
  }, [setActiveRide]);

  useRideSocket(activeRide?.id, {
    onDriverLocation: (event) => {
      setDriverPosition({
        lat: event.lat,
        lng: event.lng,
      });
      setDriverHeading(event.heading);
      // Local receive time: authoritative for staleness even if the server's
      // `at` is a little off our clock.
      lastFixAtRef.current = Date.now();
      setDriverStale(false);
    },
    onStatus: (event) => {
      if (event.status === 'completed' || event.status === 'cancelled') {
        void checkTerminalStatus();
      }
    },
  });

  // Back from the background (or socket reconnected): the ride may have been
  // completed/cancelled meanwhile — check right now instead of waiting.
  useResyncOnForeground(() => void checkTerminalStatus());

  // 3s polling fallback for terminal states (socket may be reconnecting).
  // Stops itself after the first terminal state.
  useEffect(() => {
    if (!activeRide?.id) return;
    void checkTerminalStatus();
    const timer = setInterval(() => {
      if (terminalRef.current) {
        clearInterval(timer);
        return;
      }
      void checkTerminalStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeRide?.id, checkTerminalStatus]);

  // Stale fix watchdog: if the socket goes quiet (tunnel, network drop) dim
  // the car and say we're reconnecting; the next fix clears it.
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

  // Safety: share a read-only live link (expires; revocable server-side).
  const shareTrip = async () => {
    const rideId = useRideStore.getState().activeRide?.id;
    if (!rideId || sharing) return;
    setSharing(true);
    try {
      const link = await safetyApi.shareTrip(rideId);
      const where = link.url ?? link.path;
      await Share.share({ message: `Follow my Vazhi trip live: ${where}` });
    } catch (err) {
      Alert.alert("Couldn't share trip", getApiError(err));
    } finally {
      setSharing(false);
    }
  };

  // Safety: SOS flags the ride for the team, then offers the fast actions.
  const raiseSos = () => {
    Alert.alert('Send SOS?', 'This alerts the Vazhi team about this trip.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send SOS',
        style: 'destructive',
        onPress: async () => {
          const rideId = useRideStore.getState().activeRide?.id;
          if (!rideId) return;
          try {
            const res = await safetyApi.sos(rideId, driverPosition);
            const buttons: { text: string; onPress?: () => void; style?: 'cancel' }[] = [
              { text: `Call ${res.emergencyNumber}`, onPress: () => void Linking.openURL(`tel:${res.emergencyNumber}`) },
            ];
            if (res.emergencyContact?.phone) {
              const phone = res.emergencyContact.phone;
              buttons.unshift({
                text: `Message ${res.emergencyContact.name ?? 'contact'}`,
                onPress: () => void Linking.openURL(`sms:${phone}`),
              });
            }
            buttons.push({ text: 'Close', style: 'cancel' });
            Alert.alert('SOS sent', 'The Vazhi team has been alerted.', buttons);
          } catch (err) {
            // Never leave the user stranded: the phone call still works offline.
            Alert.alert('SOS not sent', `${getApiError(err)}\n\nCall emergency services if you are in danger.`, [
              { text: 'Call 112', onPress: () => void Linking.openURL('tel:112') },
              { text: 'Close', style: 'cancel' },
            ]);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Live Tracking Map */}
      <RealMapView
        mode="tracking"
        dropoff={dropoff}
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

      {/* Live ETA chip — hidden until the first route result (no fake numbers) */}
      {etaText && (
        <View
          style={[
            styles.etaPill,
            driverStale && styles.etaPillStale,
            { top: 16 + insets.top },
          ]}
        >
          {driverStale ? (
            <WifiOff size={14} color="#FFFFFF" />
          ) : (
            <Clock size={14} color="#FFFFFF" />
          )}
          <Text style={styles.etaPillText} numberOfLines={1}>{etaText}</Text>
        </View>
      )}

      {/* Safety SOS Quick Button */}
      <TouchableOpacity
        style={[styles.sosFloatingBtn, { top: 16 + insets.top }]}
        onPress={raiseSos}
        accessibilityRole="button"
        accessibilityLabel="Send SOS"
      >
        <ShieldAlert
          size={22}
          color="#FFFFFF"
        />

        <Text style={styles.sosText}>
          SOS
        </Text>
      </TouchableOpacity>

      {/* Locate driver + Follow, floating above the bottom sheet */}
      {driverPosition && (
        <MapRecenterButtons
          onLocate={locateDriver}
          followOn={followDriver}
          onToggleFollow={toggleFollow}
          bottomOffset={sheetHeight}
        />
      )}

      {/* Bottom Sheet Navigation Card */}
      <View
        style={[styles.bottomSheet, { paddingBottom: 20 + insets.bottom }]}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.dragHandle} />

        <View style={styles.destHeader}>
          <MapPin
            size={22}
            color={colors.danger}
          />

          <View style={styles.destInfo}>
            <Text style={styles.destLabel}>
              HEADING TO
            </Text>

            <Text style={styles.destName}>
              {dropoffAddress}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionChip}
            onPress={shareTrip}
            disabled={sharing}
          >
            <Share2
              size={16}
              color={colors.primary}
            />

            <Text style={styles.chipText}>
              Share Trip
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionChip}
            onPress={raiseSos}
          >
            <ShieldAlert
              size={16}
              color={colors.primary}
            />

            <Text style={styles.chipText}>
              Safety Toolkit
            </Text>
          </TouchableOpacity>
        </View>

        {__DEV__ && (
          <Button
            title="Complete Trip (Simulate)"
            onPress={onCompleteTrip}
            variant="success"
            size="large"
          />
        )}
        {onCancelRide && (
          <Button
            title="Cancel Ride"
            onPress={onCancelRide}
            variant="outline"
            size="large"
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

  topInfoBar: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.card,
    ...shadows.card,
  },

  etaCol: {},

  etaTitle: {
    ...typography.heading,
    fontSize: 20,
    color: colors.accent,
  },

  etaSub: {
    ...typography.meta,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },

  speedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    gap: 6,
  },

  speedText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  etaPill: {
    position: 'absolute',
    top: 20,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    gap: 6,
    maxWidth: '62%',
    ...shadows.card,
  },

  etaPillStale: {
    backgroundColor: colors.warning,
  },

  etaPillText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    flexShrink: 1,
  },

  sosFloatingBtn: {
    position: 'absolute',
    top: 90,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    gap: 4,
    ...shadows.button,
  },

  sosText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
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

  destHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  destInfo: {
    flex: 1,
  },

  destLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
  },

  destName: {
    ...typography.bodyBold,
    fontSize: 14,
  },

  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },

  actionChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    paddingVertical: 10,
    borderRadius: radii.button,
    gap: 6,
  },

  chipText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.primary,
  },
});