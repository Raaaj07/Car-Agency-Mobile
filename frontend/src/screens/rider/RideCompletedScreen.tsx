import React from 'react';
import { View, Text, StyleSheet, ScrollView, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, Clock, Navigation, Home, Receipt } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { useRideStore } from '../../store/rideStore';
import { usePreventBack } from '../../navigation/navHelpers';

interface Props {
  onGoHome: () => void;
}

export const RideCompletedScreen: React.FC<Props> = ({ onGoHome }) => {
  // D3: back from the completed-ride screen goes Home — never into the
  // payment/review chain that is still mounted underneath it.
  usePreventBack(onGoHome);
  const insets = useSafeAreaInsets();
  // Real trip data from the completed ride (no demo numbers).
  const activeRide = useRideStore((state) => state.activeRide);
  const driver = activeRide?.driver ?? null;
  const driverName = driver?.name?.trim() || 'Your driver';
  const vehicleInfo =
    [driver?.vehicleModel, driver?.plateNumber].filter((p): p is string => !!p && p.trim().length > 0).join(' • ') ||
    'Thanks for riding with Vazhi';
  const totalPaid = Number(activeRide?.fareBreakdown?.total ?? 0) + Number(activeRide?.tipAmount ?? 0);
  const distanceKm = Number(activeRide?.distanceKm ?? 0);
  const durationMins = (() => {
    const started = activeRide?.createdAt ? Date.parse(activeRide.createdAt) : NaN;
    const ended = activeRide?.completedAt ? Date.parse(activeRide.completedAt) : NaN;
    return Number.isFinite(started) && Number.isFinite(ended) && ended > started
      ? Math.max(1, Math.round((ended - started) / 60000))
      : null;
  })();
  // Receipt: plain-text summary through the system share sheet (save, WhatsApp,
  // email…). Built only from this ride's own data; nothing is invented.
  const shareReceipt = async () => {
    if (!activeRide) return;
    const when = activeRide.completedAt ?? activeRide.createdAt;
    const lines = [
      'Vazhi ride receipt',
      `Ride: ${activeRide.id}`,
      when ? `Date: ${new Date(when).toLocaleString()}` : null,
      `From: ${activeRide.pickup?.address ?? '-'}`,
      `To: ${activeRide.dropoff?.address ?? '-'}`,
      distanceKm > 0 ? `Distance: ${distanceKm.toFixed(1)} km` : null,
      `Fare: ₹${Number(activeRide.fareBreakdown?.total ?? 0).toFixed(2)}`,
      Number(activeRide.tipAmount ?? 0) > 0 ? `Tip: ₹${Number(activeRide.tipAmount).toFixed(2)}` : null,
      `Total: ₹${totalPaid.toFixed(2)}`,
      `Payment: ${String(activeRide.paymentMethod).toUpperCase()} (${activeRide.paymentStatus})`,
      driver?.name ? `Driver: ${driver.name}${vehicleInfo ? ` · ${vehicleInfo}` : ''}` : null,
    ].filter((l): l is string => !!l);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // Share sheet dismissed/unavailable — nothing to recover.
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 190 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Celebration Banner */}
        <View style={[styles.celebrationBox, { marginTop: 20 + insets.top }]}>
          <View style={styles.iconCircleOuter}>
            <View style={styles.iconCircleInner}>
              <CheckCircle2 size={44} color="#FFFFFF" />
            </View>
          </View>

          <Text style={styles.title}>Ride Completed!</Text>
          <Text style={styles.subtitle}>Hope you had a safe and comfortable trip with Vazhi</Text>
        </View>

        {/* Trip Stats Metrics Card */}
        <Card style={styles.statsCard}>
          <View style={styles.statsGrid}>
            <View style={styles.statCol}>
              <Navigation size={20} color={colors.accent} />
              <Text style={styles.statVal}>{distanceKm > 0 ? `${distanceKm.toFixed(1)} km` : '—'}</Text>
              <Text style={styles.statLabel}>Distance</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statCol}>
              <Clock size={20} color={colors.primary} />
              <Text style={styles.statVal}>{durationMins != null ? `${durationMins} mins` : '—'}</Text>
              <Text style={styles.statLabel}>Trip Duration</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statCol}>
              <Text style={styles.currencySymbol}>₹</Text>
              <Text style={styles.statVal}>{totalPaid > 0 ? totalPaid.toFixed(0) : '—'}</Text>
              <Text style={styles.statLabel}>Total Paid</Text>
            </View>
          </View>
        </Card>

        {/* Driver Acknowledgement Card */}
        <Card style={styles.driverCard}>
          <View style={styles.driverRow}>
            <Avatar name={driverName} rating={driver?.rating ?? undefined} uri={driver?.avatar ?? undefined} size={50} />
            <View style={styles.driverText}>
              <Text style={styles.driverName}>Driven by {driverName}</Text>
              <Text style={styles.vehicleInfo}>{vehicleInfo}</Text>
            </View>
          </View>
        </Card>

        {/* Next Offer Card */}
        <Card style={styles.offerCard}>
          <View style={styles.offerBadge}>
            <Text style={styles.offerBadgeText}>NEXT RIDE</Text>
          </View>
          <Text style={styles.offerTitle}>Get ₹50 Off Your Return Trip</Text>
          <Text style={styles.offerSub}>Valid for the next 24 hours in Salem city</Text>
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 20 + insets.bottom, gap: 10 }]}>
        <Button
          title="Share receipt"
          onPress={shareReceipt}
          variant="outline"
          size="large"
          leftIcon={<Receipt size={20} color={colors.primary} />}
        />
        <Button
          title="Back to Home Dashboard"
          onPress={onGoHome}
          variant="primary"
          size="large"
          leftIcon={<Home size={20} color="#FFFFFF" />}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 110,
    gap: 18,
  },
  celebrationBox: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
  },
  iconCircleOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconCircleInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.heading,
    fontSize: 28,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    maxWidth: 280,
  },
  statsCard: {
    padding: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.success,
  },
  statVal: {
    ...typography.heading,
    fontSize: 18,
    marginTop: 4,
  },
  statLabel: {
    ...typography.meta,
    fontSize: 11,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.borderLight,
  },
  driverCard: {
    padding: 16,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverText: {
    flex: 1,
  },
  driverName: {
    ...typography.cardTitle,
    fontSize: 15,
  },
  vehicleInfo: {
    ...typography.meta,
    fontSize: 12,
  },
  offerCard: {
    padding: 18,
    backgroundColor: '#FFF6ED',
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  offerBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  offerBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  offerTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    color: colors.textPrimary,
  },
  offerSub: {
    ...typography.meta,
    fontSize: 12,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    ...shadows.card,
  },
});
