import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { Bell, Phone, Clock, ChevronRight } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LatLng } from '../../components/primitives/RealMapView';
import { driversApi, DriverProfile } from '../../api/drivers';
import { ridesApi } from '../../api/rides';
import { getApiError } from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import { useRideStore } from '../../store/rideStore';
import { NotificationBar } from '../../components/primitives/NotificationBar';
import { useAuthStore } from '../../store/authStore';
import { connectSocket, disconnectSocket } from '../../lib/socket';
import { tokenManager } from '../../lib/tokenManager';

const LOCATION_HEARTBEAT_MS = 5000;

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

export const DriverDashboardScreen: React.FC<Props> = ({ onRideRequest }) => {
  const navigation = useNavigation<any>();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null); // null = still checking
  const [driverCoords, setDriverCoords] = useState<LatLng | undefined>();
  const [showWelcome, setShowWelcome] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestCoords = useRef<LatLng | undefined>(undefined);

  const socket = useSocket();
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const activeRide = useRideStore((state) => state.activeRide);
  const firstName = (profile?.name ?? 'Driver').trim().split(' ')[0];

  useEffect(() => {
    if (useAuthStore.getState().justLoggedIn) {
      setShowWelcome(true);
      useAuthStore.getState().clearJustLoggedIn();
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
    } else {
      stopHeartbeat();
    }
    return stopHeartbeat;
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

  // ── Go-online toggle ───────────────────────────────────────────────────────
  const handleToggle = async (nextStatus: boolean) => {
    if (nextStatus) {
      // 1. Ensure location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Required',
          'Please grant location permission to go online. Open Settings and enable location for this app.',
        );
        return;
      }
      // 2. Get a fresh GPS fix and push it before toggling status
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setDriverCoords(coords);
        latestCoords.current = coords;
        await driversApi.updateLocation(coords.lat, coords.lng);
      } catch {
        Alert.alert('GPS Error', 'Unable to get your current location. Please try again.');
        return;
      }
    }

    try {
      await driversApi.setStatus(nextStatus);
      setIsOnline(nextStatus);
    } catch (error) {
      Alert.alert('Unable to update availability', getApiError(error));
    }
  };

  // ── Switch to Rider mode ─────────────────────────────────────────────
  // Online drivers are set offline first; an active trip blocks the switch.
  const switchToRider = async () => {
    const current = useRideStore.getState().activeRide;
    if (current && ['matched', 'driver_en_route', 'in_progress'].includes(current.status)) {
      Alert.alert('Trip in progress', 'You cannot switch modes while a trip is active. Complete or cancel it first.');
      return;
    }
    try {
      if (isOnline) {
        await driversApi.setStatus(false);
        setIsOnline(false);
      }
    } catch (error) {
      Alert.alert('Unable to go offline', getApiError(error));
      return;
    }
    stopHeartbeat();
    useAuthStore.getState().setActiveMode('rider');
    useRideStore.getState().resetRide();
    disconnectSocket();
    const token = tokenManager.getAccessToken();
    if (token) connectSocket(token, 'rider');
    // No explicit navigation: MainTabNavigator swaps to the rider tree
    // (initial route HomeTab) as soon as activeMode flips.
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

        <Button title="Switch to Rider mode" variant="outline" onPress={switchToRider} style={styles.switchBtn} />
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
  switchBtn: { marginHorizontal: 20, marginTop: 8 },
});
