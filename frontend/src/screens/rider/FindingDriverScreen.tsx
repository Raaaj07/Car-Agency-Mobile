import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Navigation, KeyRound } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { ridesApi } from '../../api/rides';
import { driversApi, NearbyDriver } from '../../api/drivers';
import { getRoute, RouteResult } from '../../api/mapbox';
import { useRideStore } from '../../store/rideStore';
import { usePreventBack, useRequireActiveRide } from '../../navigation/navHelpers';
import { nextRideAction } from '../../navigation/rideTransition';

interface Props {
  onDriverFound: () => void;
  // Two distinct intents that used to share one `onCancel` prop — that's
  // what caused the confirmation modal to reopen after you'd already
  // confirmed cancellation.
  onCancelPress: () => void; // user tapped "Cancel Search" — open the confirmation modal
  onRideCancelled: () => void; // the ride is already cancelled — go straight to the outcome screen
}

/** Nearby-driver snapshot cadence while the search is live. */
const NEARBY_REFRESH_MS = 5000;

export const FindingDriverScreen: React.FC<Props> = ({ onDriverFound, onCancelPress, onRideCancelled }) => {
  const [progress, setProgress] = useState<number>(30);
  const [nearbyDrivers, setNearbyDrivers] = useState<LatLng[]>([]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [retrying, setRetrying] = useState(false);

  const activeRide = useRideStore((state) => state.activeRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const matchResult = useRideStore((state) => state.matchResult);
  const setMatchResult = useRideStore((state) => state.setMatchResult);
  const pickupCoords = useRideStore((state) => state.pickupCoords);
  const dropoffCoords = useRideStore((state) => state.dropoffCoords);
  const pickupAddress = useRideStore((state) => state.pickupAddress);
  const dropoffAddress = useRideStore((state) => state.dropoffAddress);

  // D2: back must never walk into the booking form while a search is running —
  // open the cancel-confirmation modal instead (same intent as Cancel Search).
  usePreventBack(onCancelPress);
  // D4: if the ride vanished under this screen, go home — never a dead
  // "Searching…" page.
  useRequireActiveRide();
  const insets = useSafeAreaInsets();

  // D5: the poll used to depend on the whole activeRide object (replaced on
  // every poll) plus inline callback props, so it re-armed after it had already
  // fired and could push a duplicate YouGotTheRide while mounted behind the
  // newer screens. Depend on the ride id only; hold callbacks in refs.
  const onDriverFoundRef = useRef(onDriverFound);
  const onRideCancelledRef = useRef(onRideCancelled);
  useEffect(() => {
    onDriverFoundRef.current = onDriverFound;
    onRideCancelledRef.current = onRideCancelled;
  });

  // R-1: the search came back empty — be honest about it instead of spinning
  // at 90% forever. (If nobody is found at all, the server auto-cancels the
  // ride after its search window and the poll below routes to the outcome.)
  // The server keeps looking while the ride waits: when a driver comes online it
  // offers them the ride, the ride then carries a driverId and this state ends.
  const driverOffered = !!activeRide?.driverId;
  const isNoDrivers = activeRide?.status === 'requested' && matchResult === 'no_drivers' && !driverOffered;

  const retrySearch = async () => {
    if (!activeRide || retrying) return;
    setRetrying(true);
    try {
      const updated = await ridesApi.rematch(activeRide.id);
      setActiveRide(updated);
      setMatchResult(updated.match?.status ?? 'no_drivers');
    } catch {
      // Network hiccup: keep the no-drivers state — the poll and the server's
      // search window still resolve the ride either way.
    } finally {
      setRetrying(false);
    }
  };

  // Poll the ride's own status. Once it reaches a terminal state, polling
  // stops immediately (hasResolved + clearInterval) — this is what stops the
  // "cancellation appears twice" bug: previously this kept firing onCancel()
  // every 3s for as long as this screen stayed mounted in the background.
  useEffect(() => {
    const rideId = activeRide?.id;
    if (!rideId) return;
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
        const ride = await ridesApi.get(rideId);
        if (!isMounted || hasResolved) return;
        setActiveRide(ride);

        // The decision lives in navigation/rideTransition (pure, unit-tested).
        const action = nextRideAction('FindingDriver', ride.status);
        if (action === 'advance') {
          hasResolved = true;
          stopPolling();
          onDriverFoundRef.current();
        } else if (action === 'cancel') {
          hasResolved = true;
          stopPolling();
          onRideCancelledRef.current();
        } else {
          setProgress((current) => Math.min(current + 5, 90));
        }
      } catch {
        // Keep the search screen visible; the user can retry by returning and booking again.
      }
    };

    void checkRide();
    timerId = setInterval(() => void checkRide(), 3000);
    // Timers are frozen while backgrounded: re-check the moment we return.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkRide();
    });

    return () => {
      isMounted = false;
      hasResolved = true;
      stopPolling();
      appStateSub.remove();
    };
  }, [activeRide?.id, setActiveRide]);

  // Nearby online/available drivers around the pickup point — shown as dots
  // on the map. Polled separately so a failure here never interrupts the
  // ride-status polling above. Coordinates only (the API is redacted), and
  // polling stops as soon as the ride leaves `requested` (driver found /
  // cancelled) or the screen unmounts.
  useEffect(() => {
    if (!pickupCoords || activeRide?.status !== 'requested') return;
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
    const timer = setInterval(loadNearby, NEARBY_REFRESH_MS);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [pickupCoords, activeRide?.vehicleType, activeRide?.status]);

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
  }, [pickupCoords, dropoffCoords]);

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
      <View style={[styles.bottomSheet, { paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.dragHandle} />

        <View style={styles.searchingHeader}>
          <View style={styles.radarIconWrap}>
            <Navigation size={24} color={isNoDrivers ? colors.danger : colors.accent} />
          </View>
          <View style={styles.searchingTextWrap}>
            <Text style={styles.searchingTitle}>
              {isNoDrivers
                ? retrying
                  ? 'Searching again...'
                  : 'No drivers nearby'
                : 'Searching for your driver...'}
            </Text>
            <Text style={styles.searchingSub}>
              {isNoDrivers
                ? 'We keep looking and will connect you as soon as a driver comes online. You can also retry now or cancel.'
                : driverOffered
                  ? 'A nearby driver was notified. Waiting for them to accept...'
                  : nearbyDrivers.length > 0
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

        {isNoDrivers ? (
          <View style={styles.noDriversActions}>
            <Button
              title="Retry Search"
              onPress={retrySearch}
              variant="primary"
              size="medium"
              loading={retrying}
              disabled={retrying}
              style={styles.noDriversBtn}
            />
            <Button
              title="Cancel Search"
              onPress={onCancelPress}
              variant="outline"
              size="medium"
              disabled={retrying}
              style={styles.noDriversBtn}
            />
          </View>
        ) : (
          <Button
            title="Cancel Search"
            onPress={onCancelPress}
            variant="outline"
            size="medium"
            style={styles.cancelBtn}
          />
        )}
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
  noDriversActions: { flexDirection: 'row', gap: 12 },
  noDriversBtn: { flex: 1 },
});