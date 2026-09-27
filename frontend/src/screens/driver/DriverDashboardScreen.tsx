import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import { Zap, ChevronRight } from 'lucide-react-native';
import * as Location from 'expo-location';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { BottomTabBar } from '../../components/primitives/BottomTabBar';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { driversApi } from '../../api/drivers';
import { getApiError } from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import { useRideStore } from '../../store/rideStore';

interface Props {
  onSimulateRequest: () => void;
  onRideRequest: () => void;
}

export const DriverDashboardScreen: React.FC<Props> = ({ onSimulateRequest, onRideRequest }) => {
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('home');
  const [driverCoords, setDriverCoords] = useState<LatLng | undefined>();
  const socket = useSocket();
  const setActiveRide = useRideStore((state) => state.setActiveRide);

  // Show the driver's own current position on the map, and report it once
  // so GET /drivers/nearby (rider matching) can actually find this driver.
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
        driversApi.updateLocation(coords.lat, coords.lng).catch(() => {});
      } catch {
        // Map just falls back to its default center if location isn't available.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handleRideRequest = (request: {
      rideId: string;
      pickup: { address: string; lat: number; lng: number };
      dropoff: { address: string; lat: number; lng: number };
      vehicleType: string;
      fareBreakdown: { baseFare: number; distanceFare: number; timeCharge: number; tollFee: number; taxes: number; discount: number; total: number };
      distanceKm?: string;
      expiresInSeconds?: number;
    }) => {
      // Previously only rideId + fareBreakdown were kept, so
      // RideRequestNearbyScreen had no pickup/dropoff to show on its map.
      setActiveRide({
        id: request.rideId,
        status: 'requested',
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

  return (
    <View style={styles.container}>
      {/* Live map centered on the driver's current position */}
      <RealMapView mode="picker" pickup={driverCoords} />

      {/* Top Floating Driver Bar */}
      <View style={styles.topBar}>
        <View style={styles.driverProfileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>R</Text>
          </View>
          <View>
            <Text style={styles.driverName}>Rajesh Kumar</Text>
            <View style={styles.statusPillRow}>
              <View style={[styles.statusDot, { backgroundColor: isOnline ? colors.success : colors.textMuted }]} />
              <Text style={styles.statusText}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.toggleWrap}>
          <Switch
            value={isOnline}
            onValueChange={async (nextStatus) => {
              try {
                await driversApi.setStatus(nextStatus);
                setIsOnline(nextStatus);
                if (nextStatus && driverCoords) {
                  driversApi.updateLocation(driverCoords.lat, driverCoords.lng).catch(() => {});
                }
              } catch (error) {
                Alert.alert('Unable to update availability', getApiError(error));
              }
            }}
            trackColor={{ false: colors.border, true: colors.successLight }}
            thumbColor={isOnline ? colors.success : '#9CA3AF'}
          />
        </View>
      </View>

      {/* Bottom Sheet Dashboard Card */}
      <View style={styles.bottomSheet}>
        {/* Earnings Card Header */}
        <Card style={styles.earningsCard}>
          <View style={styles.earningsHeader}>
            <View>
              <Text style={styles.earningsLabel}>TODAY&apos;S EARNINGS</Text>
              <Text style={styles.earningsAmount}>₹1,850.00</Text>
            </View>
            <View style={styles.payoutBadge}>
              <Text style={styles.payoutText}>Ready to Cash Out</Text>
            </View>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metricCol}>
              <Text style={styles.metricVal}>8</Text>
              <Text style={styles.metricLabel}>Trips</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.metricCol}>
              <Text style={styles.metricVal}>6.2 hrs</Text>
              <Text style={styles.metricLabel}>Online Time</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.metricCol}>
              <Text style={styles.metricVal}>4.9 ★</Text>
              <Text style={styles.metricLabel}>Rating</Text>
            </View>
          </View>
        </Card>

        {/* High Demand Alert Banner */}
        <TouchableOpacity style={styles.demandBanner} onPress={onSimulateRequest}>
          <View style={styles.demandIcon}>
            <Zap size={22} color={colors.accent} />
          </View>
          <View style={styles.demandTextWrap}>
            <Text style={styles.demandTitle}>High Demand in Indiranagar 🔥</Text>
            <Text style={styles.demandSub}>Surge pricing +1.5x active nearby</Text>
          </View>
          <ChevronRight size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Trigger incoming request button */}
        <Button
          title="Simulate Incoming Ride Request"
          onPress={onSimulateRequest}
          variant="accent"
          size="large"
          disabled={!isOnline}
        />
      </View>

      <BottomTabBar activeTab={activeTab} onTabPress={setActiveTab} mode="driver" />
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
  toggleWrap: {},
  bottomSheet: {
    position: 'absolute', bottom: 84, left: 0, right: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, ...shadows.modal, gap: 14,
  },
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
  demandBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF6ED', padding: 12, borderRadius: radii.card, borderWidth: 1, borderColor: 'rgba(224, 138, 52, 0.3)' },
  demandIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  demandTextWrap: { flex: 1 },
  demandTitle: { ...typography.bodyBold, fontSize: 14, color: colors.textPrimary },
  demandSub: { ...typography.meta, fontSize: 12 },
});