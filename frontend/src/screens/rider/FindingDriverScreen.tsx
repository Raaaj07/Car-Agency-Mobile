import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Navigation, KeyRound } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { ridesApi } from '../../api/rides';
import { driversApi, NearbyDriver } from '../../api/drivers';
import { getRoute, RouteResult } from '../../api/mapbox';
import { useRideStore } from '../../store/rideStore';

interface Props {
  onDriverFound: () => void;
  // Two distinct intents that used to share one `onCancel` prop — that's
  // what caused the confirmation modal to reopen after you'd already
  // confirmed cancellation.
  onCancelPress: () => void; // user tapped "Cancel Search" — open the confirmation modal
  onRideCancelled: () => void; // the ride is already cancelled — go straight to the outcome screen
}

export const FindingDriverScreen: React.FC<Props> = ({ onDriverFound, onCancelPress, onRideCancelled }) => {
  const [progress, setProgress] = useState<number>(30);
  const [nearbyDrivers, setNearbyDrivers] = useState<LatLng[]>([]);
  const [route, setRoute] = useState<RouteResult | null>(null);

  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const pickupCoords = useRideStore((state) => state.pickupCoords);
  const dropoffCoords = useRideStore((state) => state.dropoffCoords);
  const pickupAddress = useRideStore((state) => state.pickupAddress);
  const dropoffAddress = useRideStore((state) => state.dropoffAddress);

  // Poll the ride's own status. Once it reaches a terminal state, polling
  // stops immediately (hasResolved + clearInterval) — this is what stops the
  // "cancellation appears twice" bug: previously this kept firing onCancel()
  // every 3s for as long as this screen stayed mounted in the background.
  useEffect(() => {
    if (!activeRide) return;
    let isMounted = true;
    let hasResolved = false;
    let timerId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const checkRide = async () => {
      if (hasResolved) return;
      try {
        const ride = await ridesApi.get(activeRide.id);
        if (!isMounted || hasResolved) return;
        setActiveRide(ride);

        if (ride.status === 'matched' || ride.status === 'driver_en_route') {
          hasResolved = true;
          stopPolling();
          onDriverFound();
        } else if (ride.status === 'cancelled') {
          hasResolved = true;
          stopPolling();
          onRideCancelled();
        } else {
          setProgress((current) => Math.min(current + 5, 90));
        }
      } catch {
        // Keep the search screen visible; the user can retry by returning and booking again.
      }
    };

    void checkRide();
    timerId = setInterval(() => void checkRide(), 3000);

    return () => {
      isMounted = false;
      hasResolved = true;
      stopPolling();
    };
  }, [activeRide?.id, onDriverFound, onRideCancelled, setActiveRide]);

  // Nearby online/available drivers around the pickup point — shown as dots
  // on the map. Polled separately so a failure here never interrupts the
  // ride-status polling above.
  useEffect(() => {
    if (!pickupCoords) return;
    let isMounted = true;

    const loadNearby = async () => {
      try {
        const results: NearbyDriver[] = await driversApi.nearby(
          pickupCoords.lat,
          pickupCoords.lng,
          activeRide?.vehicleType,
        );
        if (isMounted) setNearbyDrivers(results.map((d) => ({ lat: d.lat, lng: d.lng })));
      } catch {
        // Non-critical — the search continues without the dots.
      }
    };

    void loadNearby();
    const timer = setInterval(loadNearby, 6000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [pickupCoords?.lat, pickupCoords?.lng, activeRide?.vehicleType]);

  // Road route preview between pickup and dropoff.
  useEffect(() => {
    let isMounted = true;
    if (!pickupCoords || !dropoffCoords) return;
    getRoute(pickupCoords, dropoffCoords)
      .then((result) => {
        if (isMounted) setRoute(result);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [pickupCoords?.lat, pickupCoords?.lng, dropoffCoords?.lat, dropoffCoords?.lng]);

  return (
    <View style={styles.container}>
      <RealMapView
        mode="picker"
        pickup={pickupCoords}
        dropoff={dropoffCoords}
        route={route?.coordinates}
        nearbyDrivers={nearbyDrivers}
      />

      {/* Bottom Sheet Card */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        <View style={styles.searchingHeader}>
          <View style={styles.radarIconWrap}>
            <Navigation size={24} color={colors.accent} />
          </View>
          <View style={styles.searchingTextWrap}>
            <Text style={styles.searchingTitle}>Searching for your driver...</Text>
            <Text style={styles.searchingSub}>
              {nearbyDrivers.length > 0
                ? `${nearbyDrivers.length} driver${nearbyDrivers.length === 1 ? '' : 's'} nearby`
                : 'Looking for nearby drivers'}
            </Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
        </View>

        <View style={styles.locationPillRow}>
          <Text style={styles.pickupLabel}>Pickup:</Text>
          <Text style={styles.pickupVal} numberOfLines={1}>{pickupAddress || 'Current location'}</Text>
        </View>
        <View style={styles.locationPillRow}>
          <Text style={styles.pickupLabel}>Drop:</Text>
          <Text style={styles.pickupVal} numberOfLines={1}>{dropoffAddress || 'Destination'}</Text>
        </View>

        {activeRide?.pickupOtp ? (
          <View style={styles.otpPillRow}>
            <KeyRound size={16} color={colors.primary} />
            <Text style={styles.otpPillLabel}>Pickup OTP:</Text>
            <Text style={styles.otpPillVal}>{activeRide.pickupOtp}</Text>
          </View>
        ) : null}

        <Button
          title="Cancel Search"
          onPress={onCancelPress}
          variant="outline"
          size="medium"
          style={styles.cancelBtn}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, ...shadows.modal, gap: 16,
  },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 4 },
  searchingHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  searchingTextWrap: { flex: 1 },
  radarIconWrap: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentLight,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  searchingTitle: { ...typography.cardTitle, fontSize: 17 },
  searchingSub: { ...typography.meta, fontSize: 13 },
  progressTrack: { height: 6, backgroundColor: colors.borderLight, borderRadius: 3, overflow: 'hidden', width: '100%' },
  progressBar: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  locationPillRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 12, borderRadius: radii.md, gap: 6 },
  pickupLabel: { ...typography.metaBold, color: colors.textMuted },
  pickupVal: { ...typography.bodyBold, fontSize: 13, flex: 1 },
  otpPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    padding: 12,
    borderRadius: radii.md,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(33, 27, 78, 0.15)',
  },
  otpPillLabel: { ...typography.metaBold, color: colors.primary, fontSize: 12 },
  otpPillVal: { ...typography.heading, fontSize: 18, color: colors.primary, letterSpacing: 2, flex: 1, textAlign: 'right' },
  cancelBtn: { marginTop: 4 },
});