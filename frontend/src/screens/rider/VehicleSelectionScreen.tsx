import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, Users, ArrowRight, CreditCard, MapPin, Navigation } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { RealMapView } from '../../components/primitives/RealMapView';
import { Header } from '../../components/primitives/Header';
import { useRideStore, VehicleOption } from '../../store/rideStore';
import { getRoute, RouteResult } from '../../api/mapbox';
import { estimateFareTotal, estimateNumericPrice } from '../../utils/fare';
import { driversApi } from '../../api/drivers';
import { etaByVehicle, etaText, EtaStatus, fastestVehicleId } from '../../utils/vehicleEta';

const vehicles: VehicleOption[] = [
  { id: 'auto', name: 'Vazhi Auto', type: 'Affordable 3-wheeler', price: '₹110', numericPrice: 110, eta: '', seats: 3, icon: '🛺' },
  { id: 'mini', name: 'Economy Mini', type: 'Compact hatchbacks', price: '₹180', numericPrice: 180, eta: '', seats: 4, icon: '🚗' },
  { id: 'sedan', name: 'Comfort Sedan', type: 'Spacious AC sedans', price: '₹240', numericPrice: 240, eta: '', seats: 4, icon: '🚘' },
  { id: 'suv', name: 'Premium SUV', type: '6-seater family rides', price: '₹350', numericPrice: 350, eta: '', seats: 6, icon: '🚙' },
];

interface Props {
  onBack?: () => void;
  onConfirmVehicle?: (vehicle: VehicleOption) => void;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export const VehicleSelectionScreen: React.FC<Props> = ({ onBack, onConfirmVehicle }) => {
  const storeSelectedVehicle = useRideStore((state) => state.selectedVehicle);
  const setSelectedVehicleStore = useRideStore((state) => state.setSelectedVehicle);
  const pickupCoords = useRideStore((state) => state.pickupCoords);
  const dropoffCoords = useRideStore((state) => state.dropoffCoords);
  const preferredVehicleId = useRideStore((state) => state.preferredVehicleId);
  const setPreferredVehicle = useRideStore((state) => state.setPreferredVehicle);

  // Pre-select preferred vehicle on mount (set by Home screen Explore tiles), then clear it.
  const initialId = preferredVehicleId ?? storeSelectedVehicle?.id ?? 'sedan';
  const [selectedId, setSelectedId] = useState<string>(initialId);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const insets = useSafeAreaInsets();
  // Real arrival times from the drivers online near the pickup (replaces the fixed
  // "3 min away" / "Fastest" values the list used to show).
  const [etaStatus, setEtaStatus] = useState<EtaStatus>('loading');
  const [etas, setEtas] = useState<Record<string, number>>({});

  useEffect(() => {
    if (preferredVehicleId) {
      // Async boundary — sync setState directly in the effect trips
      // react-hooks/set-state-in-effect (value already matches the lazy
      // useState initial, so this lands as a no-op either way).
      Promise.resolve().then(() => setSelectedId(preferredVehicleId));
      // Find and pre-apply in store so RideDetails shows the right price.
      const preferred = vehicles.find((v) => v.id === preferredVehicleId);
      if (preferred) setSelectedVehicleStore(preferred);
      setPreferredVehicle(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedVehicle = vehicles.find((v) => v.id === selectedId) || vehicles[2];

  // Fares follow the route distance (same formula as the server). Until the route
  // is known, a typical 5 km trip is shown and labelled as such.
  const distanceKm = route ? route.distanceMeters / 1000 : null;
  const priceFor = (v: VehicleOption) => {
    const numericPrice = estimateNumericPrice(v.id, distanceKm) ?? v.numericPrice;
    return { numericPrice, total: estimateFareTotal(numericPrice) };
  };
  // The vehicle as it goes into the store: priced for THIS trip, so the ride
  // summary's total matches what is shown here.
  const pricedVehicle = (v: VehicleOption): VehicleOption => {
    const { numericPrice, total } = priceFor(v);
    return { ...v, numericPrice, price: `₹${total}` };
  };

  // Fetch the real road-following route (and distance/ETA) once both ends
  // of the trip are known.
  useEffect(() => {
    let mounted = true;
    if (!pickupCoords || !dropoffCoords) {
      // Async boundary — sync setState directly in the effect trips
      // react-hooks/set-state-in-effect; a microtask is invisible next to
      // the route fetch it guards.
      Promise.resolve().then(() => setRoute(null));
      return;
    }
    Promise.resolve().then(() => {
      setIsLoadingRoute(true);
      setRouteError(false);
    });
    getRoute(pickupCoords, dropoffCoords)
      .then((result) => {
        if (!mounted) return;
        if (result) {
          setRoute(result);
        } else {
          setRouteError(true);
        }
      })
      .catch(() => {
        if (mounted) setRouteError(true);
      })
      .finally(() => {
        if (mounted) setIsLoadingRoute(false);
      });
    return () => {
      mounted = false;
    };
  }, [pickupCoords, dropoffCoords]);

  // Nearby drivers: once for this pickup, then every 30 s while the screen is open.
  const pickupLat = pickupCoords?.lat;
  const pickupLng = pickupCoords?.lng;
  useEffect(() => {
    if (pickupLat == null || pickupLng == null) return;
    let mounted = true;
    const load = () => {
      driversApi
        .nearby(pickupLat, pickupLng)
        .then((drivers) => {
          if (!mounted) return;
          setEtas(etaByVehicle(drivers));
          setEtaStatus('ready');
        })
        .catch(() => {
          if (mounted) setEtaStatus('error');
        });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [pickupLat, pickupLng]);
  const effectiveEtaStatus: EtaStatus = pickupLat == null || pickupLng == null ? 'error' : etaStatus;
  const fastestId = effectiveEtaStatus === 'ready' ? fastestVehicleId(etas) : null;

  const handleSelect = (v: VehicleOption) => {
    setSelectedId(v.id);
    setSelectedVehicleStore(pricedVehicle(v));
  };

  const handleConfirm = () => {
    const priced = pricedVehicle(selectedVehicle);
    setSelectedVehicleStore(priced);
    if (onConfirmVehicle) {
      onConfirmVehicle(priced);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Map View */}
      <View style={styles.mapWrap}>
        <RealMapView mode="picker" pickup={pickupCoords} dropoff={dropoffCoords} route={route?.coordinates} bottomPadding={40} />
        {onBack && <Header onBack={onBack} transparent style={styles.mapHeader} />}

        {/* Distance / ETA strip */}
        <View style={styles.routeInfoBar}>
          {isLoadingRoute ? (
            <View style={styles.routeInfoRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.routeInfoText}>Calculating route…</Text>
            </View>
          ) : route ? (
            <View style={styles.routeInfoRow}>
              <Navigation size={14} color={colors.primary} />
              <Text style={styles.routeInfoText}>{formatDistance(route.distanceMeters)}</Text>
              <Text style={styles.routeInfoDot}>•</Text>
              <Clock size={14} color={colors.primary} />
              <Text style={styles.routeInfoText}>{formatDuration(route.durationSeconds)}</Text>
            </View>
          ) : routeError ? (
            <View style={styles.routeInfoRow}>
              <MapPin size={14} color={colors.textMuted} />
              <Text style={styles.routeInfoText}>Route unavailable</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Vehicle Options Bottom Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />
        <Text style={styles.sheetTitle}>Choose a Ride</Text>
        <Text style={styles.sheetSub}>
          {distanceKm != null
            ? 'Estimated fares for this route'
            : isLoadingRoute
              ? 'Calculating fares for your route…'
              : 'Fares shown for a typical 5 km trip'}
        </Text>

        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: 150 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {vehicles.map((v) => {
            const isSelected = selectedId === v.id;
            return (
              <Card key={v.id} onPress={() => handleSelect(v)} selected={isSelected} style={styles.vehicleCard}>
                <View style={styles.vehicleRow}>
                  <Text style={styles.vehicleEmoji}>{v.icon}</Text>

                  <View style={styles.infoCol}>
                    <View style={styles.nameRow}>
                      <Text style={styles.vehicleName}>{v.name}</Text>
                      {fastestId === v.id && (
                        <View style={[styles.badge, { backgroundColor: colors.successLight }]}>
                          <Text style={[styles.badgeText, { color: colors.success }]}>Fastest</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.vehicleType}>{v.type}</Text>
                    <View style={styles.metaRow}>
                      <Clock size={12} color={colors.textMuted} />
                      <Text style={styles.metaText}>{etaText(effectiveEtaStatus, etas, v.id)}</Text>
                      <Text style={styles.metaDot}>•</Text>
                      <Users size={12} color={colors.textMuted} />
                      <Text style={styles.metaText}>{v.seats} seats</Text>
                    </View>
                  </View>

                  <View style={styles.priceCol}>
                    <Text style={[styles.priceText, isSelected && styles.priceTextActive]}>₹{priceFor(v).total}</Text>
                  </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>

        {/* Footer Bar with Payment Choice & Action */}
        <View style={[styles.footerPanel, { paddingBottom: 16 + insets.bottom }]}>
          {/* Static label: payment is a UPI QR / cash settled with the driver after the trip. */}
          <View style={styles.paymentSelector}>
            <CreditCard size={18} color={colors.primary} />
            <Text style={styles.paymentText}>Pay the driver: UPI QR / Cash</Text>
          </View>

          <Button
            title={`Book ${selectedVehicle.name}`}
            onPress={handleConfirm}
            variant="accent"
            size="large"
            rightIcon={<ArrowRight size={20} color="#FFFFFF" />}
            style={styles.confirmBtn}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapWrap: { height: '45%', position: 'relative' },
  // Header already adds the status-bar inset itself, so pin it to the very top.
  mapHeader: { position: 'absolute', top: 0, left: 0, right: 0 },
  routeInfoBar: {
    position: 'absolute', bottom: 12, alignSelf: 'center',
    backgroundColor: '#FFFFFF', borderRadius: radii.pill, paddingHorizontal: 16, paddingVertical: 8,
    ...shadows.card,
  },
  routeInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routeInfoText: { ...typography.bodyBold, fontSize: 13, color: colors.textPrimary },
  routeInfoDot: { color: colors.textMuted, marginHorizontal: 2 },
  bottomSheet: {
    flex: 1, backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    marginTop: -20, paddingTop: 12, paddingHorizontal: 20, ...shadows.modal,
  },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { ...typography.subheading, fontSize: 18, marginBottom: 4 },
  sheetSub: { ...typography.meta, fontSize: 12, marginBottom: 12 },
  list: { gap: 12, paddingBottom: 100 },
  vehicleCard: { padding: 14 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center' },
  vehicleEmoji: { fontSize: 34, marginRight: 14 },
  infoCol: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vehicleName: { ...typography.cardTitle, fontSize: 16 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { ...typography.metaBold, fontSize: 10 },
  vehicleType: { ...typography.meta, fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  metaText: { ...typography.meta, fontSize: 11 },
  metaDot: { color: colors.textMuted },
  priceCol: { alignItems: 'flex-end' },
  priceText: { ...typography.heading, fontSize: 18 },
  priceTextActive: { color: colors.accent },
  footerPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
    padding: 16, borderTopWidth: 1, borderTopColor: colors.borderLight, gap: 12, ...shadows.card,
  },
  paymentSelector: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radii.md, gap: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border,
  },
  paymentText: { ...typography.bodyBold, fontSize: 13 },
  confirmBtn: { width: '100%' },
});