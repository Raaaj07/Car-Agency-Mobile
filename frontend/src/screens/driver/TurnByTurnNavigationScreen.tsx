import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { CornerUpRight, Phone, Gauge, MapPin, CheckCircle, Navigation, ExternalLink } from 'lucide-react-native';
import * as Location from 'expo-location';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { useRideStore } from '../../store/rideStore';
import { useSocket } from '../../hooks/useSocket';
import { driversApi } from '../../api/drivers';
import { openGoogleMapsNavigation } from '../../utils/maps';

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

  const destinationAddress =
    (isToPickup ? activeRide?.pickup?.address : activeRide?.dropoff?.address) ??
    (isToPickup ? 'Heading to pickup location' : 'Heading to drop-off location');

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

  const handleOpenGoogleMaps = () => {
    const target = isToPickup ? activeRide?.pickup : activeRide?.dropoff;
    if (!target || target.lat == null || target.lng == null) {
      Alert.alert(
        'Location Unavailable',
        `No coordinates available for ${isToPickup ? 'pickup' : 'drop-off'} location.`
      );
      return;
    }

    openGoogleMapsNavigation(
      {
        lat: target.lat,
        lng: target.lng,
        address: target.address,
      },
      driverPosition
    );
  };

  return (
    <View style={styles.container}>
      <RealMapView
        mode="navigation"
        darkTheme
        pickup={activeRide?.pickup}
        dropoff={activeRide?.dropoff}
        driverPosition={driverPosition}
      />

      {/* Top Direction Instruction Header */}
      <View style={styles.navHeader}>
        <View style={styles.arrowIconWrap}>
          <CornerUpRight size={28} color="#FFFFFF" />
        </View>
        <View style={styles.navTextWrap}>
          <Text style={styles.distText}>
            {isToPickup ? 'EN ROUTE TO PICKUP' : 'TRIP IN PROGRESS'}
          </Text>
          <Text style={styles.turnInstruction} numberOfLines={1}>
            {isToPickup ? 'Navigate to pickup point' : 'Navigate to drop-off point'}
          </Text>
        </View>

        <View style={styles.speedBadge}>
          <Gauge size={14} color={colors.accent} />
          <Text style={styles.speedVal}>45 km/h</Text>
        </View>
      </View>

      {/* Floating "Open in Google Maps" Button on the Map */}
      <TouchableOpacity
        style={styles.floatingGmapsBtn}
        onPress={handleOpenGoogleMaps}
        activeOpacity={0.85}
      >
        <View style={styles.gmapsIconWrap}>
          <Navigation size={18} color="#FFFFFF" />
        </View>
        <View style={styles.gmapsTextWrap}>
          <Text style={styles.gmapsBtnTitle}>Open in Google Maps</Text>
          <Text style={styles.gmapsBtnSub}>
            {isToPickup ? 'Route to Pickup' : 'Route to Drop-off'}
          </Text>
        </View>
        <ExternalLink size={16} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Bottom Navigation Control Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.etaTitle}>
              {isToPickup ? 'PICKUP PHASE' : 'DROP-OFF PHASE'}
            </Text>
            <Text style={styles.etaSub}>
              {isToPickup ? 'Rider is waiting at pickup location' : 'Heading towards destination'}
            </Text>
          </View>

          <TouchableOpacity style={styles.callBtn}>
            <Phone size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.destBox}>
          <MapPin size={18} color={isToPickup ? colors.success : colors.danger} />
          <View style={styles.destTextWrap}>
            <Text style={styles.destLabel}>
              {isToPickup ? 'PICKUP LOCATION' : 'DROP-OFF LOCATION'}
            </Text>
            <Text style={styles.destText} numberOfLines={1}>
              {destinationAddress}
            </Text>
          </View>
        </View>

        {/* Secondary Navigation Button inside sheet */}
        <TouchableOpacity
          style={styles.sheetGmapsBtn}
          onPress={handleOpenGoogleMaps}
          activeOpacity={0.85}
        >
          <Navigation size={18} color={colors.primary} />
          <Text style={styles.sheetGmapsText}>
            {isToPickup ? 'Open Pickup in Google Maps' : 'Open Drop-off in Google Maps'}
          </Text>
          <ExternalLink size={16} color={colors.primary} />
        </TouchableOpacity>

        <Button
          title={isToPickup ? 'Arrived at Pickup (Enter OTP)' : 'Complete Trip'}
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
  turnInstruction: { ...typography.cardTitle, fontSize: 15, color: '#FFFFFF' },
  speedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, gap: 4 },
  speedVal: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },

  // Floating Google Maps Button on Map
  floatingGmapsBtn: {
    position: 'absolute',
    top: 96,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 10,
    ...shadows.card,
  },
  gmapsIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gmapsTextWrap: {
    flex: 1,
  },
  gmapsBtnTitle: {
    ...typography.bodyBold,
    color: '#FFFFFF',
    fontSize: 13,
  },
  gmapsBtnSub: {
    ...typography.meta,
    color: colors.accent,
    fontSize: 11,
  },

  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, ...shadows.modal, gap: 12,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  etaTitle: { ...typography.heading, fontSize: 20, color: colors.primary },
  etaSub: { ...typography.meta, fontSize: 12 },
  callBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },

  destBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  destTextWrap: { flex: 1 },
  destLabel: { ...typography.metaBold, fontSize: 9, color: colors.textMuted },
  destText: { ...typography.bodyBold, fontSize: 13 },

  sheetGmapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(33, 27, 78, 0.15)',
  },
  sheetGmapsText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.primary,
  },
});