import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

import {
  ShieldAlert,
  Share2,
  MapPin,
} from 'lucide-react-native';

import {
  colors,
  radii,
  typography,
  shadows,
} from '../../theme/theme';

import { Button } from '../../components/primitives/Button';
import { RealMapView } from '../../components/primitives/RealMapView';
import { useRideSocket } from '../../hooks/useSocket';
import { useRideStore } from '../../store/rideStore';
import { getRoute } from '../../api/mapbox';
import { ridesApi } from '../../api/rides';

interface Props {
  onCompleteTrip: () => void;
  onCancelRide?: () => void;
  onRideCancelled?: (reason?: string) => void;
  onEmergencyPress?: () => void;
}

export const TripProgressScreen: React.FC<Props> = ({
  onCompleteTrip,
  onCancelRide,
  onRideCancelled,
  onEmergencyPress,
}) => {
  const [driverPosition, setDriverPosition] = useState<
    { lat: number; lng: number } | undefined
  >();
  const [route, setRoute] = useState<[number, number][] | undefined>(undefined);
  // Measured bottom-sheet height so the map can pad the fit above it.
  const [sheetHeight, setSheetHeight] = useState(0);

  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);

  const pickupCoords = useRideStore(
    (state) => state.pickupCoords
  );

  const dropoffCoords = useRideStore(
    (state) => state.dropoffCoords
  );

  const storeDropoffAddress = useRideStore((state) => state.dropoffAddress);

  const dropoffAddress = activeRide?.dropoff?.address || storeDropoffAddress || 'Drop-off';

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
  },
  onStatus: (event) => {
    if (event.status === 'completed' || event.status === 'cancelled') {
      void checkTerminalStatus();
    }
  },
});

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

  // Fetch the road-following route once so the map fits pickup, drop and
  // the road line. Failures leave the map to fit just the endpoints.
  useEffect(() => {
    let mounted = true;
    if (!pickupCoords || !dropoffCoords) {
      // Async boundary — sync setState directly in the effect trips
      // react-hooks/set-state-in-effect; a microtask is invisible next to
      // the route fetch it guards.
      Promise.resolve().then(() => setRoute(undefined));
      return;
    }
    getRoute(pickupCoords, dropoffCoords)
      .then((result) => {
        if (mounted && result) setRoute(result.coordinates);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [pickupCoords, dropoffCoords]);

  return (
    <View style={styles.container}>
      {/* Live Tracking Map */}
      <RealMapView
        mode="tracking"
        pickup={pickupCoords}
        dropoff={dropoffCoords}
        driverPosition={driverPosition}
        route={route}
        bottomPadding={sheetHeight}
      />

      {/* Safety SOS Quick Button */}
      <TouchableOpacity
        style={styles.sosFloatingBtn}
        onPress={onEmergencyPress}
      >
        <ShieldAlert
          size={22}
          color="#FFFFFF"
        />

        <Text style={styles.sosText}>
          SOS
        </Text>
      </TouchableOpacity>

      {/* Bottom Sheet Navigation Card */}
      <View
        style={styles.bottomSheet}
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