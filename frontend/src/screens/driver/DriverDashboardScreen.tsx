import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert, TouchableOpacity } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { BottomTabBar } from '../../components/primitives/BottomTabBar';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { driversApi, DriverProfile } from '../../api/drivers';
import { ridesApi } from '../../api/rides';
import { getApiError } from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import { useRideStore } from '../../store/rideStore';
import { NotificationBar } from '../../components/primitives/NotificationBar';
import { useAuthStore } from '../../store/authStore';

const LOCATION_HEARTBEAT_MS = 5000;

interface Props {
  onRideRequest: () => void;
}

export const DriverDashboardScreen: React.FC<Props> = ({ onRideRequest }) => {
  const navigation = useNavigation<any>();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null); // null = still checking
  const [activeTab, setActiveTab] = useState('home');
  const [driverCoords, setDriverCoords] = useState<LatLng | undefined>();
  const [showWelcome, setShowWelcome] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestCoords = useRef<LatLng | undefined>(undefined);

  const socket = useSocket();
  const setActiveRide = useRideStore((state) => state.setActiveRide);

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
        setProfile(p);
        setIsOnline(p.isOnline);
        setIsRegistered(true);
      })
      .catch(() => {
        setIsRegistered(false);
      });
  };

  useEffect(loadProfile, []);

  // ── Initial GPS fix (shows driver dot on the map) ─────────────────────────
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
        // Map falls back to its default center if location isn't available.
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
  const checkPendingOffer = useCallback(async () => {
    try {
      const pending = await ridesApi.getPendingOffer();
      if (pending?.ride) {
        setActiveRide({
          ...pending.ride,
          expiresInSeconds: pending.remainingSeconds,
        });
        onRideRequest();
      }
    } catch {
      // Ignored
    }
  }, [setActiveRide, onRideRequest]);

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

  return (
    <View style={styles.container}>
      <RealMapView mode="picker" pickup={driverCoords} />

      <View style={styles.topBar}>
        <View style={styles.driverProfileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(profile?.name ?? 'D').charAt(0).toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.driverName}>{profile?.name ?? 'Driver'}</Text>
            <View style={styles.statusPillRow}>
              <View style={[styles.statusDot, { backgroundColor: isOnline ? colors.success : colors.textMuted }]} />
              <Text style={styles.statusText}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            </View>
          </View>
        </View>

        <Switch
          value={isOnline}
          disabled={isRegistered !== true}
          onValueChange={handleToggle}
          trackColor={{ false: colors.border, true: colors.successLight }}
          thumbColor={isOnline ? colors.success : '#9CA3AF'}
        />
      </View>

      <View style={styles.bottomSheet}>
        {isRegistered === false && (
          <TouchableOpacity
            style={styles.registerBanner}
            onPress={() => navigation.getParent()?.navigate('AccountTab')}
          >
            <AlertCircle size={20} color={colors.danger} />
            <View style={styles.registerTextWrap}>
              <Text style={styles.registerTitle}>Complete your driver registration</Text>
              <Text style={styles.registerSub}>Add your vehicle details in Account to start going online</Text>
            </View>
          </TouchableOpacity>
        )}

        <Card style={styles.earningsCard}>
          <View style={styles.earningsHeader}>
            <View>
              <Text style={styles.earningsLabel}>TODAY&apos;S EARNINGS</Text>
              <Text style={styles.earningsAmount}>₹{(profile?.todayEarnings ?? 0).toFixed(2)}</Text>
            </View>
            <View style={styles.payoutBadge}>
              <Text style={styles.payoutText}>Ready to Cash Out</Text>
            </View>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metricCol}>
              <Text style={styles.metricVal}>{profile?.todayTrips ?? 0}</Text>
              <Text style={styles.metricLabel}>Trips Today</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.metricCol}>
              <Text style={styles.metricVal}>{profile?.totalTrips ?? 0}</Text>
              <Text style={styles.metricLabel}>Lifetime Trips</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.metricCol}>
              <Text style={styles.metricVal}>{profile ? `${profile.rating.toFixed(1)} ★` : '—'}</Text>
              <Text style={styles.metricLabel}>Rating</Text>
            </View>
          </View>
        </Card>

        <Text style={styles.waitingText}>
          {isOnline ? "You're online — waiting for ride requests…" : 'Go online to start receiving ride requests'}
        </Text>
      </View>

      <BottomTabBar activeTab={activeTab} onTabPress={setActiveTab} mode="driver" />

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
  topBar: {
    position: 'absolute', top: 16, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', padding: 12, borderRadius: radii.card,
    ...shadows.card, borderWidth: 1, borderColor: '#EEECF2',
  },
  driverProfileRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '700', fontSize: 18 },
  driverName: { ...typography.bodyBold, fontSize: 15 },
  statusPillRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...typography.metaBold, fontSize: 11 },
  bottomSheet: {
    position: 'absolute', bottom: 84, left: 0, right: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, ...shadows.modal, gap: 14,
  },
  registerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    padding: 12, borderRadius: radii.card,
  },
  registerTextWrap: { flex: 1 },
  registerTitle: { ...typography.bodyBold, fontSize: 13, color: colors.danger },
  registerSub: { ...typography.meta, fontSize: 11 },
  earningsCard: { padding: 18, backgroundColor: colors.primary },
  earningsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  earningsLabel: { ...typography.metaBold, fontSize: 10, color: 'rgba(255, 255, 255, 0.7)', letterSpacing: 1 },
  earningsAmount: { ...typography.heading, fontSize: 28, color: colors.accent },
  payoutBadge: { backgroundColor: colors.success, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  payoutText: { color: '#FFFFFF', fontWeight: '700', fontSize: 10 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.15)' },
  metricCol: { alignItems: 'center' },
  metricVal: { ...typography.cardTitle, fontSize: 16, color: '#FFFFFF' },
  metricLabel: { ...typography.meta, fontSize: 11, color: 'rgba(255, 255, 255, 0.7)' },
  divider: { width: 1, height: 24, backgroundColor: 'rgba(255, 255, 255, 0.2)' },
  waitingText: { ...typography.meta, textAlign: 'center', color: colors.textMuted },
});