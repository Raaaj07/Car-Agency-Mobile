import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Phone, MessageSquare, ArrowRight, KeyRound } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { useRideStore } from '../../store/rideStore';
import { useRideSocket } from '../../hooks/useSocket';
import { ridesApi } from '../../api/rides';
import { getRoute } from '../../api/mapbox';
import { haversineKm } from '../../utils/distance';

interface Props {
  onTrackDriver: () => void;
  /** The ride was cancelled (driver / system) while the rider was on this screen. */
  onRideCancelled?: (reason?: string) => void;
}

// Re-route (and refresh the ETA) only after the driver moved this far, or
// after this long — keeps Mapbox Directions calls to a handful per minute.
const REROUTE_DISTANCE_KM = 0.15;
const REROUTE_MAX_AGE_MS = 30_000;
// REST fallback so the map still moves if the socket is reconnecting.
const POLL_MS = 5000;

export const YouGotTheRideScreen: React.FC<Props> = ({ onTrackDriver, onRideCancelled }) => {
  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const storePickupCoords = useRideStore((state) => state.pickupCoords);
  const storeDropoffCoords = useRideStore((state) => state.dropoffCoords);

  const rideId = activeRide?.id;
  const pickupOtp = activeRide?.pickupOtp;
  // The ride record from the server is the source of truth for addresses and
  // coordinates; the booking-form values in the store are only a fallback.
  const pickupAddress = activeRide?.pickup?.address || 'Pickup Point';
  const dropoffAddress = activeRide?.dropoff?.address || 'Dropoff Point';
  const pickupLat = activeRide?.pickup?.lat ?? storePickupCoords?.lat;
  const pickupLng = activeRide?.pickup?.lng ?? storePickupCoords?.lng;
  const dropoffLat = activeRide?.dropoff?.lat ?? storeDropoffCoords?.lat;
  const dropoffLng = activeRide?.dropoff?.lng ?? storeDropoffCoords?.lng;
  const pickup = useMemo<LatLng | undefined>(
    () => (pickupLat != null && pickupLng != null ? { lat: pickupLat, lng: pickupLng } : undefined),
    [pickupLat, pickupLng],
  );
  const dropoff = useMemo<LatLng | undefined>(
    () => (dropoffLat != null && dropoffLng != null ? { lat: dropoffLat, lng: dropoffLng } : undefined),
    [dropoffLat, dropoffLng],
  );

  // Real assigned driver (from the ride payload), including profile photo.
  const driver = activeRide?.driver ?? null;
  const driverName = driver?.name?.trim() || 'Your driver';
  const vehicleModel = driver?.vehicleModel?.trim() || 'Vehicle assigned for your ride';
  const plateNumber = driver?.plateNumber?.trim();

  // Live driver position: seeded from the server's last known location, then
  // kept fresh by socket events (and the REST poll below as a fallback).
  const [driverPos, setDriverPos] = useState<LatLng | undefined>(() =>
    driver?.location ? { lat: driver.location.lat, lng: driver.location.lng } : undefined,
  );
  const [route, setRoute] = useState<[number, number][] | undefined>(undefined);
  const [routeEtaMin, setRouteEtaMin] = useState<number | null>(null);
  // Measured bottom-sheet height so the map pads its fit above the sheet.
  const [sheetHeight, setSheetHeight] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onRideCancelledRef = useRef(onRideCancelled);
  useEffect(() => {
    onRideCancelledRef.current = onRideCancelled;
  });
  const cancelledRef = useRef(false);

  const handleDriverPos = useCallback((lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setDriverPos((prev) => (prev && prev.lat === lat && prev.lng === lng ? prev : { lat, lng }));
  }, []);

  // Live driver location + status pushes for this ride's socket room.
  useRideSocket(rideId, {
    onDriverLocation: (event) => handleDriverPos(event.lat, event.lng),
    onStatus: (event) => {
      if (event.status === 'cancelled' && !cancelledRef.current) {
        cancelledRef.current = true;
        onRideCancelledRef.current?.(event.cancellationReason ?? undefined);
      }
    },
  });

  // REST fallback: refreshes the driver's last known position (and catches a
  // cancel the socket missed). Mirrors FindingDriver / DriverEnRoute polling.
  useEffect(() => {
    if (!rideId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const ride = await ridesApi.get(rideId);
        if (stopped || !mountedRef.current) return;
        if (ride.status === 'cancelled') {
          if (!cancelledRef.current) {
            cancelledRef.current = true;
            setActiveRide(ride);
            onRideCancelledRef.current?.(ride.cancellationReason ?? undefined);
          }
          return;
        }
        setActiveRide(ride);
        if (ride.driver?.location) handleDriverPos(ride.driver.location.lat, ride.driver.location.lng);
      } catch {
        // Transient network error — the next tick retries.
      }
    };
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rideId, setActiveRide, handleDriverPos]);

  // Real road route + ETA from the driver to the pickup point (Mapbox
  // Directions). Throttled by distance moved / age.
  const lastRouteRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const driverLat = driverPos?.lat;
  const driverLng = driverPos?.lng;
  useEffect(() => {
    if (driverLat == null || driverLng == null || !pickup) return;
    const now = Date.now();
    const last = lastRouteRef.current;
    if (
      last &&
      now - last.at < REROUTE_MAX_AGE_MS &&
      haversineKm(last, { lat: driverLat, lng: driverLng }) < REROUTE_DISTANCE_KM
    ) {
      return;
    }
    lastRouteRef.current = { lat: driverLat, lng: driverLng, at: now };
    getRoute({ lat: driverLat, lng: driverLng }, pickup)
      .then((result) => {
        if (!mountedRef.current || !result) return;
        setRoute(result.coordinates);
        setRouteEtaMin(Math.max(1, Math.round(result.durationSeconds / 60)));
      })
      .catch(() => {
        // Keep the previous route/ETA; the distance-based estimate below covers it.
      });
  }, [driverLat, driverLng, pickup]);

  // ETA shown to the rider: Mapbox's road ETA when we have it, otherwise a
  // straight-line estimate (x1.3 road factor at ~25 km/h city speed, same
  // assumption the backend uses). null until the driver's position is known.
  const etaMin = useMemo<number | null>(() => {
    if (routeEtaMin != null) return routeEtaMin;
    if (driverLat == null || driverLng == null || !pickup) return null;
    const km = haversineKm({ lat: driverLat, lng: driverLng }, pickup) * 1.3;
    return Math.max(1, Math.round((km / 25) * 60));
  }, [routeEtaMin, driverLat, driverLng, pickup]);

  const etaText = etaMin != null ? `${etaMin} min` : null;

  return (
    <View style={styles.container}>
      {/* Live map: pickup, drop-off, the driver's real position and the road
          route driver -> pickup, all kept in frame above the sheet. */}
      <RealMapView
        mode="tracking"
        followDriver={false}
        pickup={pickup}
        dropoff={dropoff}
        driverPosition={driverPos}
        route={route}
        bottomPadding={sheetHeight}
      />

      {/* Pickup / drop summary over the map (real addresses from the ride) */}
      <View style={styles.topCard} pointerEvents="none">
        <View style={styles.locationRow}>
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={styles.locationText} numberOfLines={1}>{pickupAddress}</Text>
        </View>
        <View style={styles.locationDivider} />
        <View style={styles.locationRow}>
          <View style={[styles.dot, { backgroundColor: colors.danger }]} />
          <Text style={styles.locationText} numberOfLines={1}>{dropoffAddress}</Text>
        </View>
      </View>

      {/* Driver Matched Sheet */}
      <View style={styles.bottomSheet} onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
        <View style={styles.matchBanner}>
          <Text style={styles.matchBannerText}>🎉 You Got the Ride!</Text>
          <Text style={styles.matchSubText}>
            {etaText ? `Driver arrives in about ${etaText}` : 'Locating your driver…'}
          </Text>
        </View>

        {/* Start OTP Code Box */}
        <View style={styles.otpBox}>
          <View style={styles.otpLeft}>
            <KeyRound size={20} color={colors.primary} />
            <Text style={styles.otpLabel}>START RIDE OTP</Text>
          </View>
          <Text style={styles.otpValue}>{pickupOtp ?? '----'}</Text>
        </View>

        {/* Driver Details Card */}
        <Card style={styles.driverCard}>
          <View style={styles.driverRow}>
            <Avatar
              name={driverName}
              rating={driver?.rating ?? undefined}
              uri={driver?.avatar ?? undefined}
              size={54}
              online
            />

            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{driverName}</Text>
              <Text style={styles.vehicleName}>{vehicleModel}</Text>
              {plateNumber ? (
                <View style={styles.plateBadge}>
                  <Text style={styles.plateText}>{plateNumber}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.actionsCol}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.successLight }]}>
                <Phone size={18} color={colors.success} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#EEF2FF' }]}>
                <MessageSquare size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </Card>

        <Button
          title="Track Driver En Route"
          onPress={onTrackDriver}
          variant="primary"
          size="large"
          rightIcon={<ArrowRight size={20} color="#FFFFFF" />}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  topCard: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    padding: 14,
    ...shadows.card,
    borderWidth: 1,
    borderColor: '#EEECF2',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 8,
    marginLeft: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  locationText: {
    ...typography.bodyBold,
    fontSize: 14,
    flex: 1,
  },
  matchBanner: {
    backgroundColor: colors.accentLight,
    padding: 12,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  matchBannerText: {
    ...typography.cardTitle,
    fontSize: 18,
    color: colors.accent,
  },
  matchSubText: {
    ...typography.metaBold,
    fontSize: 12,
    color: colors.textPrimary,
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
    gap: 8,
  },
  otpLabel: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.primary,
    letterSpacing: 1,
  },
  otpValue: {
    ...typography.heading,
    fontSize: 22,
    color: colors.primary,
    letterSpacing: 4,
  },
  driverCard: {
    padding: 16,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  vehicleName: {
    ...typography.meta,
    fontSize: 12,
    marginBottom: 4,
  },
  plateBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
  },
  plateText: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  actionsCol: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
