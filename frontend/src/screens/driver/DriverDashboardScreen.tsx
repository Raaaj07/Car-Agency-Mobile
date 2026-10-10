import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { Bell, Phone, Clock, ChevronRight } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { LatLng } from '../../components/primitives/RealMapView';
import { driversApi, DriverProfile } from '../../api/drivers';
import { ridesApi, Ride } from '../../api/rides';
import { getApiError } from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import { useRideStore } from '../../store/rideStore';
import { NotificationBar } from '../../components/primitives/NotificationBar';
import { useAuthStore } from '../../store/authStore';
import {
  promptBackgroundLocationOnce,
  startDriverBackgroundLocation,
  stopDriverBackgroundLocation,
} from '../../lib/locationTask';

const LOCATION_HEARTBEAT_MS = 5000;
// Reuse a GPS fix younger than this when going online: the server only
// needs locationUpdatedAt ≤2 min old, so a quick off→on toggle reuses the
// last heartbeat fix instead of waiting for a cold GPS lock.
const FRESH_FIX_MS = 60_000;

interface Props {
  onRideRequest: () => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// Where a server-reported in-flight trip should resume. Live trips re-enter
// the navigation screen for their phase; a completed-but-unpaid trip goes to
// the payment step.
type TripTarget =
  | { screen: 'TurnByTurnNavigation'; phase: 'to_pickup' | 'in_progress' }
  | { screen: 'DriverPayment' };

function tripTarget(ride: Ride): TripTarget | null {
  if (ride.status === 'matched' || ride.status === 'driver_en_route') {
    return { screen: 'TurnByTurnNavigation', phase: 'to_pickup' };
  }
  if (ride.status === 'in_progress') return { screen: 'TurnByTurnNavigation', phase: 'in_progress' };
  if (ride.status === 'completed') return { screen: 'DriverPayment' };
  return null;
}

function tripLabel(ride: Ride): string {
  switch (ride.status) {
    case 'matched':
    case 'driver_en_route':
      return 'Heading to pickup';
    case 'in_progress':
      return 'Trip in progress';
    case 'completed':
      return 'Collect payment';
    default:
      return 'Active ride';
  }
}

export const DriverDashboardScreen: React.FC<Props> = ({ onRideRequest }) => {
  const navigation = useNavigation<any>();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null); // null = still checking
  // Value is never read (only the setters below trigger re-renders).
  const [, setDriverCoords] = useState<LatLng | undefined>();
  const [showWelcome, setShowWelcome] = useState(false);
  // Driver's in-flight trip as reported by the server (survives app restarts).
  const [activeTrip, setActiveTrip] = useState<Ride | null>(null);
  // Auto-enter a live trip only once per mount, otherwise pressing Back from
  // the trip screen would bounce the driver straight back in.
  const autoResumed = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestCoords = useRef<LatLng | undefined>(undefined);
  // When latestCoords was last refreshed (see FRESH_FIX_MS).
  const latestCoordsAt = useRef(0);
  // Toggle bookkeeping: the Switch flips optimistically, so rapid taps are
  // common. Each tap gets a sequence number (only the latest may roll the
  // UI back) and status requests are serialised through statusChain so the
  // server can never end up in the opposite state of the UI.
  const toggleSeq = useRef(0);
  const statusChain = useRef<Promise<unknown>>(Promise.resolve());
  // Last offer we already surfaced (socket OR polling) so the request screen
  // is opened exactly once per offer.
  const lastOfferId = useRef<string | null>(null);
  const onRideRequestRef = useRef(onRideRequest);
  useEffect(() => {
    onRideRequestRef.current = onRideRequest;
  }, [onRideRequest]);

  const socket = useSocket();
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const activeRide = useRideStore((state) => state.activeRide);
  const firstName = (profile?.name ?? 'Driver').trim().split(' ')[0];

  useEffect(() => {
    if (useAuthStore.getState().justLoggedIn) {
      // Async boundary — calling setShowWelcome directly in the effect body
      // trips react-hooks/set-state-in-effect (setState belongs in a callback).
      Promise.resolve().then(() => {
        setShowWelcome(true);
        useAuthStore.getState().clearJustLoggedIn();
      });
    }
  }, []);

  const loadProfile = () => {
    driversApi
      .getMyProfile()
      .then((p) => {
        if (!p) {
          setProfile(null);
          setIsOnline(false);
          setIsRegistered(false);
          return;
        }
        setProfile(p);
        setIsOnline(p.isOnline);
        setIsRegistered(true);
      })
      .catch(() => {
        setIsRegistered(false);
      });
  };

  useEffect(loadProfile, []);

  // ── Resume an in-flight trip ───────────────────────────────────────────────
  // The store only lives in memory, so after a restart / back-navigation the
  // driver had no way back into an accepted trip. Ask the server instead.
  const resumeTrip = useCallback(
    (ride: Ride) => {
      const target = tripTarget(ride);
      if (!target) return;
      setActiveRide(ride);
      if (target.screen === 'TurnByTurnNavigation') {
        navigation.navigate('TurnByTurnNavigation', { phase: target.phase });
      } else {
        navigation.navigate('DriverPayment');
      }
    },
    [navigation, setActiveRide],
  );

  const loadActiveTrip = useCallback(async () => {
    try {
      const trip = await ridesApi.getDriverActive();
      setActiveTrip(trip);
      if (trip && !autoResumed.current && trip.status !== 'completed') {
        autoResumed.current = true;
        resumeTrip(trip);
      }
    } catch {
      // Not an approved driver yet / transient network error — no card shown.
    }
  }, [resumeTrip]);

  useEffect(() => {
    // Async boundary — calling a state-setting function synchronously in the
    // effect body trips react-hooks/set-state-in-effect (same pattern as
    // setShowWelcome above).
    Promise.resolve().then(() => loadActiveTrip());
    // Refresh whenever the dashboard regains focus (e.g. after finishing a
    // trip or pressing Back from the trip screen).
    const unsubscribe = navigation.addListener('focus', () => {
      void loadActiveTrip();
      // Pick up a UPI ID saved on the Profile tab while this screen stayed
      // mounted (hides the "Add your UPI ID" banner without a restart).
      driversApi
        .getMyProfile()
        .then((p) => {
          if (p) setProfile(p);
        })
        .catch(() => {});
    });
    return unsubscribe;
  }, [navigation, loadActiveTrip]);

  // ── Initial GPS fix ───────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !mounted) return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!mounted) return;
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setDriverCoords(coords);
        latestCoords.current = coords;
        latestCoordsAt.current = Date.now();
      } catch {
        // Location stays unset; going online will prompt for GPS.
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ── Location heartbeat while online ───────────────────────────────────────
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) return;
    heartbeatRef.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setDriverCoords(coords);
        latestCoords.current = coords;
        latestCoordsAt.current = Date.now();
        driversApi.updateLocation(coords.lat, coords.lng).catch(() => {});
      } catch {
        // Ignored — GPS may be momentarily unavailable
      }
    }, LOCATION_HEARTBEAT_MS);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isOnline) {
      startHeartbeat();
      // D-4: OS-level updates keep the heartbeat alive while the app is
      // backgrounded/locked (best-effort no-op without background permission
      // or outside a dev build — foreground interval above still runs).
      void startDriverBackgroundLocation();
    } else {
      stopHeartbeat();
      void stopDriverBackgroundLocation();
    }
    return () => {
      stopHeartbeat();
      void stopDriverBackgroundLocation();
    };
  }, [isOnline, startHeartbeat, stopHeartbeat]);

  // ── Check for a pending offer on mount and on socket reconnect ────────────
  // Populates the "Available rides" list; live offers still pop the request
  // screen via the socket handler below.
  const checkPendingOffer = useCallback(async () => {
    try {
      const pending = await ridesApi.getPendingOffer();
      if (pending?.ride) {
        setActiveRide({
          ...pending.ride,
          expiresInSeconds: pending.remainingSeconds,
        });
      }
    } catch {
      // Ignored
    }
  }, [setActiveRide]);

  // Run check on mount
  useEffect(() => {
    checkPendingOffer();
  }, [checkPendingOffer]);

  // Re-run whenever the socket reconnects (new non-null socket reference from singleton)
  const prevSocket = useRef<typeof socket>(null);
  useEffect(() => {
    if (socket && socket !== prevSocket.current) {
      prevSocket.current = socket;
      checkPendingOffer();
    }
  }, [socket, checkPendingOffer]);

  // ── Listen for incoming ride requests ─────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const handleRideRequest = (request: any) => {
      lastOfferId.current = request.rideId;
      setActiveRide({
        id: request.rideId,
        status: 'requested',
        riderName: request.riderName ?? 'Rider',
        riderAvatar: request.riderAvatar ?? null,
        fareBreakdown: request.fareBreakdown,
        paymentStatus: 'pending',
        pickup: request.pickup,
        dropoff: request.dropoff,
        vehicleType: request.vehicleType,
        distanceKm: request.distanceKm,
        expiresInSeconds: request.expiresInSeconds,
      });
      onRideRequest();
    };
    socket.on('ride:request', handleRideRequest);
    return () => {
      socket.off('ride:request', handleRideRequest);
    };
  }, [socket, setActiveRide, onRideRequest]);

  // ── Polling fallback for offers ───────────────────────────────────────────
  // Offers live only 15 s and are pushed once over the socket. If that single
  // event is missed (socket still connecting, brief network drop, app just
  // foregrounded) the driver would never see the ride. While online, also ask
  // the server for the pending offer every 4 s and open the request screen
  // for any offer the socket did not already deliver.
  useEffect(() => {
    if (!isOnline) {
      lastOfferId.current = null;
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const pending = await ridesApi.getPendingOffer();
        if (cancelled || !pending?.ride) return;
        if (pending.ride.id === lastOfferId.current) return;
        lastOfferId.current = pending.ride.id;
        setActiveRide({ ...pending.ride, expiresInSeconds: pending.remainingSeconds });
        onRideRequestRef.current();
      } catch {
        // Transient network/auth error — the next tick retries.
      }
    };
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOnline, setActiveRide]);

  // ── Go-online toggle ───────────────────────────────────────────────────────
  // The Switch is optimistic: it flips the instant you tap and reconciles
  // afterwards (rollback + alert only if this tap is still the latest),
  // instead of staying stuck for as long as a cold GPS fix plus two
  // HTTP round-trips take. Network requests are serialised through
  // statusChain so rapid taps can never land on the server out of order.
  const handleToggle = (nextStatus: boolean) => {
    const seq = ++toggleSeq.current;
    const isLatest = () => toggleSeq.current === seq;
    const fail = (title: string, message: string) => {
      if (!isLatest()) return;
      setIsOnline(!nextStatus);
      Alert.alert(title, message);
    };

    if (!nextStatus) {
      // Going offline has no server-side gates — flip instantly, then
      // reconcile; a failure snaps the switch back to server truth.
      setIsOnline(false);
      const task = statusChain.current.then(() => driversApi.setStatus(false));
      statusChain.current = task.catch(() => {});
      task.catch((error) => fail('Unable to update availability', getApiError(error)));
      return;
    }

    // Going online: permission first (near-instant when already granted),
    // and only then flip — a denied permission never flashes an online
    // state or starts the heartbeat.
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (isLatest()) {
          Alert.alert(
            'Location Required',
            'Please grant location permission to go online. Open Settings and enable location for this app.',
          );
        }
        return;
      }
      if (!isLatest()) return;
      setIsOnline(true);

      // The server only accepts online drivers with a location ≤2 min old,
      // so freshen it first — reusing a recent fix means a quick off→on
      // toggle skips the cold-GPS wait entirely.
      let coords: LatLng | undefined = latestCoords.current;
      if (!coords || Date.now() - latestCoordsAt.current > FRESH_FIX_MS) {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setDriverCoords(coords);
          latestCoords.current = coords;
          latestCoordsAt.current = Date.now();
        } catch {
          fail('GPS Error', 'Unable to get your current location. Please try again.');
          return;
        }
      }
      if (!coords || !isLatest()) return;

      const target = coords;
      const task = statusChain.current
        .then(() => driversApi.updateLocation(target.lat, target.lng))
        .then(() => driversApi.setStatus(true));
      statusChain.current = task.catch(() => {});
      try {
        await task;
        // D-4: first go-online of the session nudges for background
        // permission (non-blocking; registering happens inside once granted).
        if (isLatest()) void promptBackgroundLocationOnce();
      } catch (error) {
        fail('Unable to update availability', getApiError(error));
      }
    })();
  };

  const openNotifications = () => {
    (navigation.getParent()?.getParent()?.getParent() as any)?.navigate?.('RideAnnouncementsSettings');
  };

  // Ignore rides restored from the rider flow: they are the user's own
  // booking, never a job offer (see clearRestoredRiderRide in MainTabNavigator).
  const pendingRequest =
    activeRide && activeRide.status === 'requested' && activeRide.source !== 'rider-restore' ? activeRide : null;
  const status = (profile as any)?.status as string | undefined;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Navy header */}
        <View style={styles.header}>
          <View style={styles.topRow}>
            <View style={styles.brandRow}>
              <View style={styles.logoBadge}>
                <Phone size={18} color={colors.accent} />
              </View>
              <Text style={styles.brandText}>vazhi</Text>
            </View>
            <TouchableOpacity style={styles.bellBtn} onPress={openNotifications} activeOpacity={0.7}>
              <Bell size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <Text style={styles.greeting}>{greeting()}, {firstName}</Text>

          <View style={styles.onlineRow}>
            <View style={styles.onlineLeft}>
              <View style={[styles.onlineDot, { backgroundColor: isOnline ? colors.success : '#6B7280' }]} />
              <Text style={styles.onlineText}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            </View>
            <Switch
              value={isOnline}
              disabled={isRegistered !== true}
              onValueChange={handleToggle}
              trackColor={{ false: 'rgba(255,255,255,0.25)', true: colors.success }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Stat cards */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Today&apos;s earnings</Text>
            <Text style={styles.earningsValue}>{inr(profile?.todayEarnings ?? 0)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Completed trips</Text>
            <Text style={styles.tripsValue}>{profile?.todayTrips ?? 0}</Text>
          </View>
        </View>

        {status === 'pending' ? (
          <Card style={styles.statusCard}>
            <Text style={styles.statusTitle}>Application under review</Text>
            <Text style={styles.statusSub}>You will be able to go online once approved.</Text>
          </Card>
        ) : null}

        {/* No payee UPI ID yet: the post-trip payment QR cannot be generated */}
        {isRegistered && profile && !profile.upiVpa ? (
          <TouchableOpacity
            style={styles.upiNudge}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ProfileTab')}
            accessibilityRole="button"
            accessibilityLabel="Add your UPI ID in Profile"
          >
            <View style={styles.upiNudgeText}>
              <Text style={styles.upiNudgeTitle}>Add your UPI ID</Text>
              <Text style={styles.upiNudgeBody}>
                Riders pay by scanning a QR made from it after each trip. Set it once in Profile.
              </Text>
            </View>
            <ChevronRight size={18} color={colors.warning} />
          </TouchableOpacity>
        ) : null}

        {/* Active ride — re-enter an accepted trip */}
        {activeTrip && tripTarget(activeTrip) ? (
          <>
            <Text style={styles.sectionTitle}>Your active ride</Text>
            <View style={[styles.rideCard, styles.activeTripCard]}>
              <View style={styles.rideTopRow}>
                <View style={styles.timeChip}>
                  <Text style={styles.timeChipText}>{tripLabel(activeTrip)}</Text>
                </View>
                <Text style={styles.fareText}>{inr(activeTrip.fareBreakdown?.total ?? 0)}</Text>
              </View>
              <View style={styles.pointRow}>
                <View style={[styles.dot, { backgroundColor: colors.success }]} />
                <Text style={styles.pointVal} numberOfLines={1}>
                  {activeTrip.pickup?.address ?? 'Pickup location'}
                </Text>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.pointRow}>
                <View style={[styles.square, { backgroundColor: colors.accent }]} />
                <Text style={styles.pointVal} numberOfLines={1}>
                  {activeTrip.dropoff?.address ?? 'Drop location'}
                </Text>
              </View>
              <View style={styles.rideBottomRow}>
                <Text style={styles.distanceText}>
                  {activeTrip.riderName ? `Rider: ${activeTrip.riderName}` : ''}
                </Text>
                <TouchableOpacity
                  style={styles.viewRideBtn}
                  onPress={() => resumeTrip(activeTrip)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.viewRideText}>Resume ride</Text>
                  <ChevronRight size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : null}

        {/* Available rides */}
        <Text style={styles.sectionTitle}>Available rides</Text>
        {pendingRequest ? (
          <View style={styles.rideCard}>
            <View style={styles.rideTopRow}>
              <View style={styles.timeChip}>
                <Text style={styles.timeChipText}>Just now</Text>
              </View>
              <Text style={styles.fareText}>{inr(pendingRequest.fareBreakdown.total)}</Text>
            </View>
            <View style={styles.pointRow}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Text style={styles.pointVal} numberOfLines={1}>
                {pendingRequest.pickup?.address ?? 'Pickup location'}
              </Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.pointRow}>
              <View style={[styles.square, { backgroundColor: colors.accent }]} />
              <Text style={styles.pointVal} numberOfLines={1}>
                {pendingRequest.dropoff?.address ?? 'Drop location'}
              </Text>
            </View>
            <View style={styles.rideBottomRow}>
              <View style={styles.distanceRow}>
                <Clock size={14} color={colors.textMuted} />
                <Text style={styles.distanceText}>
                  {pendingRequest.distanceKm ? `${pendingRequest.distanceKm} km` : '—'}
                </Text>
              </View>
              <TouchableOpacity style={styles.viewRideBtn} onPress={onRideRequest} activeOpacity={0.85}>
                <Text style={styles.viewRideText}>View Ride</Text>
                <ChevronRight size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.rideCard}>
            <Text style={styles.emptyTitle}>No ride requests right now</Text>
            <Text style={styles.emptySub}>
              {isOnline ? 'Stay online — new requests will appear here.' : 'Go online to start receiving ride requests.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <NotificationBar
        visible={showWelcome}
        title={`Welcome, ${profile?.name ?? 'Driver'} 👋`}
        subtitle="You're all set to go online"
        onDismiss={() => setShowWelcome(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: 120 },
  header: {
    backgroundColor: colors.primary,
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBadge: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  brandText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  greeting: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', marginBottom: 14 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  onlineText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  statsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: -0, paddingTop: 16 },
  statCard: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: radii.lg, padding: 16,
    ...shadows.card,
  },
  statLabel: { ...typography.meta, fontSize: 12, marginBottom: 6 },
  earningsValue: { fontSize: 22, fontWeight: '800', color: colors.accent },
  tripsValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statusCard: { marginHorizontal: 20, marginTop: 14 },
  statusTitle: { ...typography.bodyBold, fontSize: 14 },
  statusSub: { ...typography.meta, fontSize: 12 },
  sectionTitle: { ...typography.cardTitle, fontSize: 18, paddingHorizontal: 20, marginTop: 20, marginBottom: 12 },
  rideCard: {
    backgroundColor: '#FFFFFF', borderRadius: radii.lg, padding: 16, marginHorizontal: 20,
    marginBottom: 12, gap: 6, ...shadows.card,
  },
  rideTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  timeChip: { backgroundColor: colors.successLight, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radii.pill },
  timeChipText: { color: colors.success, fontSize: 12, fontWeight: '700' },
  fareText: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  square: { width: 10, height: 10, borderRadius: 2 },
  pointVal: { ...typography.bodyBold, fontSize: 14, flex: 1 },
  routeLine: { width: 2, height: 14, backgroundColor: colors.border, marginLeft: 4 },
  rideBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  distanceText: { ...typography.meta, fontSize: 13 },
  viewRideBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: radii.pill,
  },
  viewRideText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  emptyTitle: { ...typography.bodyBold, fontSize: 15, textAlign: 'center' },
  emptySub: { ...typography.meta, fontSize: 13, textAlign: 'center' },
  activeTripCard: { borderWidth: 1.5, borderColor: colors.success },
  upiNudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
    padding: 14,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.accentLight,
  },
  upiNudgeText: { flex: 1, gap: 2 },
  upiNudgeTitle: { ...typography.bodyBold, fontSize: 14, color: colors.textPrimary },
  upiNudgeBody: { ...typography.meta, fontSize: 12, color: colors.textMuted },
});
