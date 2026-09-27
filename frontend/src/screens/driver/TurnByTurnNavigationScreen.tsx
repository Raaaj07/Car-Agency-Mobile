import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CornerUpRight, Phone, Gauge, MapPin, CheckCircle } from 'lucide-react-native';
import * as Location from 'expo-location';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { useRideStore } from '../../store/rideStore';
import { useSocket } from '../../hooks/useSocket';
import { driversApi } from '../../api/drivers';

interface Props {
  phase: 'to_pickup' | 'in_progress';
  onPrimaryAction: () => void;
  isSubmitting?: boolean;
}

export const TurnByTurnNavigationScreen: React.FC<Props> = ({ phase, onPrimaryAction, isSubmitting }) => {
  const isToPickup = phase === 'to_pickup';
  const activeRide = useRideStore((state) => state.activeRide);
  const socket = useSocket();
  const [driverPosition, setDriverPosition] = useState<LatLng | undefined>();
  const watchSubscription = useRef<Location.LocationSubscription | null>(null);

  const destination: LatLng | undefined = isToPickup ? activeRide?.pickup : activeRide?.dropoff;
  const destinationAddress =
    (isToPickup ? activeRide?.pickup?.address : activeRide?.dropoff?.address) ??
    (isToPickup ? 'Heading to pickup' : 'Heading to destination');

  // Stream the driver's live position: shown on this map, pushed to the
  // backend (PostGIS/Redis via REST) and relayed to the rider's live map
  // over the ride's socket room (see rides.gateway.ts's driver:location).
  useEffect(() => {
    let mounted = true;

    const start = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || !mounted) return;

      watchSubscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 15 },
        (loc) => {
          if (!mounted) return;
          const next = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setDriverPosition(next);

          driversApi.updateLocation(next.lat, next.lng).catch(() => {});

          if (activeRide?.id && socket) {
            socket.emit('driver:location', { rideId: activeRide.id, ...next });
          }
        },
      );
    };

    start();

    return () => {
      mounted = false;
      watchSubscription.current?.remove();
      watchSubscription.current = null;
    };
  }, [activeRide?.id, socket]);

  return (
    <View style={styles.container}>
      <RealMapView mode="navigation" darkTheme dropoff={destination} driverPosition={driverPosition} />

      {/* Top Direction Instruction Header — turn-by-turn text/speed are
          still simulated; real values need a routing (Directions) API,
          which is outside this fix's scope. */}
      <View style={styles.navHeader}>
        <View style={styles.arrowIconWrap}>
          <CornerUpRight size={28} color="#FFFFFF" />
        </View>
        <View style={styles.navTextWrap}>
          <Text style={styles.distText}>IN 200 METERS</Text>
          <Text style={styles.turnInstruction}>Turn Right onto 100 Feet Road</Text>
        </View>

        <View style={styles.speedBadge}>
          <Gauge size={14} color={colors.accent} />
          <Text style={styles.speedVal}>45 km/h</Text>
        </View>
      </View>

      {/* Bottom Navigation Control Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.etaTitle}>10 MINS</Text>
            <Text style={styles.etaSub}>3.2 km remaining to destination</Text>
          </View>

          <TouchableOpacity style={styles.callBtn}>
            <Phone size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.destBox}>
          <MapPin size={18} color={colors.danger} />
          <Text style={styles.destText} numberOfLines={1}>
            {destinationAddress}
          </Text>
        </View>

        <Button
          title={isToPickup ? 'Arrived at Pickup' : 'Complete Trip'}
          onPress={onPrimaryAction}
          variant="success"
          size="large"
          loading={isSubmitting}
          disabled={isSubmitting}
          leftIcon={<CheckCircle size={20} color="#FFFFFF" />}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  navHeader: {
    position: 'absolute', top: 20, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary,
    padding: 16, borderRadius: radii.card, ...shadows.card, gap: 12,
  },
  arrowIconWrap: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  navTextWrap: { flex: 1 },
  distText: { ...typography.metaBold, fontSize: 11, color: colors.accent, letterSpacing: 1 },
  turnInstruction: { ...typography.cardTitle, fontSize: 16, color: '#FFFFFF' },
  speedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, gap: 4 },
  speedVal: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, ...shadows.modal, gap: 14,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  etaTitle: { ...typography.heading, fontSize: 26, color: colors.primary },
  etaSub: { ...typography.meta, fontSize: 12 },
  callBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  destBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 12, borderRadius: radii.md, gap: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  destText: { ...typography.bodyBold, fontSize: 13, flex: 1 },
});