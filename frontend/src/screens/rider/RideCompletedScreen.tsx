import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { CheckCircle2, Clock, Navigation, ShieldCheck, Home, ArrowRight } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { useRideStore } from '../../store/rideStore';

interface Props {
  onGoHome: () => void;
}

export const RideCompletedScreen: React.FC<Props> = ({ onGoHome }) => {
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
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Celebration Banner */}
        <View style={styles.celebrationBox}>
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

      <View style={styles.footer}>
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
