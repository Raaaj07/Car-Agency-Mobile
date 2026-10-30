import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { CornerUpRight, Gauge, MapPin, CheckCircle, Navigation, ExternalLink } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FocusedStatusBar } from '../../components/primitives/FocusedStatusBar';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { useRideStore } from '../../store/rideStore';
import { useSocket } from '../../hooks/useSocket';
import { driversApi } from '../../api/drivers';
import { ridesApi } from '../../api/rides';
import { openGoogleMapsNavigation } from '../../utils/maps';
import { announce } from '../../lib/announcer';
import { shouldWarnSpeed } from '../../utils/announcements';

interface Props {
  phase: 'to_pickup' | 'in_progress';
  onPrimaryAction: () => void;
  isSubmitting?: boolean;
  /** The rider (or system/admin) cancelled this trip while the driver was on it. */
  onRideCancelled?: () => void;
}

export const TurnByTurnNavigationScreen: React.FC<Props> = ({ phase, onPrimaryAction, isSubmitting, onRideCancelled }) => {
  const isToPickup = phase === 'to_pickup';
  const insets = useSafeAreaInsets();
  const activeRide = useRideStore((state) => state.activeRide);
  const socket = useSocket();
  const [driverPosition, setDriverPosition] = useState<LatLng | undefined>();
  const [driverHeading, setDriverHeading] = useState<number | undefined>(undefined);
  // Real GPS speed in km/h (null until the device reports one).
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  // Measured bottom-sheet height so the map keeps the car above the sheet.
  const [sheetHeight, setSheetHeight] = useState(0);
  const watchSubscription = useRef<Location.LocationSubscription | null>(null);
  // When the spoken over-speed warning was last given (it repeats at most every 30 s).
  const lastSpeedWarnAt = useRef(0);

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
          // GPS course is -1/null while stationary — send nothing in that case
          // and the rider's car marker keeps/derives its heading from movement.
          const rawHeading = loc.coords.heading;
          const heading =
            typeof rawHeading === 'number' && Number.isFinite(rawHeading) && rawHeading >= 0
              ? rawHeading
              : undefined;
          setDriverPosition(next);
          setDriverHeading(heading);
          const rawSpeed = loc.coords.speed;
          const kmh =
            typeof rawSpeed === 'number' && Number.isFinite(rawSpeed) && rawSpeed >= 0
              ? Math.round(rawSpeed * 3.6)
              : null;
          setSpeedKmh(kmh);
          // Spoken "please slow down" (Audio Announcements > Over-speed warning).
          if (shouldWarnSpeed(kmh, Date.now(), lastSpeedWarnAt.current)) {
            lastSpeedWarnAt.current = Date.now();
            void announce('slow_down');
          }

          driversApi.updateLocation(next.lat, next.lng).catch(() => {});

          if (activeRide?.id && socket) {
            socket.emit('driver:location', {
              rideId: activeRide.id,
              ...next,
              ...(heading !== undefined ? { heading } : {}),
            });
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

  // Rider cancelled mid-trip? The server pushes `ride:status` to the driver's
  // user room; an 8 s poll covers a missed event (socket reconnecting). Without
  // this the driver kept driving a dead trip and every action then failed with
  // "Ride is cancelled".
  const onCancelledRef = useRef(onRideCancelled);
  useEffect(() => {
    onCancelledRef.current = onRideCancelled;
  });
  useEffect(() => {
    const rideId = activeRide?.id;
    if (!rideId) return;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      onCancelledRef.current?.();
    };
    const handleStatus = (event: { rideId: string; status: string }) => {
      if (event.rideId === rideId && event.status === 'cancelled') fire();
    };
    socket?.on('ride:status', handleStatus);
    const poll = setInterval(() => {
      ridesApi
        .get(rideId)
        .then((r) => {
          if (r.status === 'cancelled') fire();
        })
        .catch(() => {});
    }, 8000);
    return () => {
      socket?.off('ride:status', handleStatus);
      clearInterval(poll);
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
      {/* Dark map: light status-bar icons so the clock/battery stay visible. */}
      <FocusedStatusBar style="light" />
      <RealMapView
        mode="navigation"
        darkTheme
        pickup={activeRide?.pickup}
        dropoff={activeRide?.dropoff}
        driverPosition={driverPosition}
        driverHeading={driverHeading}
        bottomPadding={sheetHeight}
      />

      {/* Top Direction Instruction Header */}
      <View style={[styles.navHeader, { top: 20 + insets.top }]}>
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
          <Text style={styles.speedVal}>{speedKmh != null ? speedKmh : '--'} km/h</Text>
        </View>
      </View>

      {/* Floating "Open in Google Maps" Button on the Map */}
      <TouchableOpacity
        style={[styles.floatingGmapsBtn, { top: 108 + insets.top }]}
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
      <View
        style={[styles.bottomSheet, { paddingBottom: 20 + insets.bottom }]}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.etaTitle}>
              {isToPickup ? 'PICKUP PHASE' : 'DROP-OFF PHASE'}
            </Text>
            <Text style={styles.etaSub}>
              {isToPickup ? 'Rider is waiting at pickup location' : 'Heading towards destination'}
            </Text>
          </View>
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
  speedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, gap: 4, minWidth: 72, justifyContent: 'center' },
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