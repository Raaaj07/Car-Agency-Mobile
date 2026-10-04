import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ArrowRight, Banknote } from 'lucide-react-native';
import { Card } from '../primitives/Card';
import { Pill } from '../primitives/Pill';
import { StatusPill } from './StatusPill';
import { AdminRideSummary } from '../../api/admin';
import { colors, typography } from '../../theme/theme';
import { inr, timeAgo } from '../../utils/format';

interface RideRowProps {
  ride: AdminRideSummary;
  onPress?: () => void;
}

/** Ride row card (spec §3.2 AdminRidesScreen row) — never shows phones. */
export const RideRow: React.FC<RideRowProps> = ({ ride, onPress }) => {
  const isCancelled = ride.status === 'cancelled';

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.names} numberOfLines={1}>
          {ride.riderName}
          <Text style={styles.arrowText}> → </Text>
          {ride.driverName}
        </Text>
        <View style={styles.pills}>
          <StatusPill kind="ride" value={ride.status} />
          {isCancelled ? (
            // A-8: cancelled rides settle nothing — show "—" not a fake PENDING.
            <Pill label="—" variant="muted" style={styles.pillGap} />
          ) : (
            <StatusPill kind="payment" value={ride.paymentStatus} style={styles.pillGap} />
          )}
        </View>
      </View>

      <View style={styles.routeRow}>
        <Text style={styles.route} numberOfLines={1}>
          {ride.pickupAddress || '—'}
        </Text>
        <ArrowRight size={13} color={colors.textMuted} style={styles.routeArrow} />
        <Text style={styles.route} numberOfLines={1}>
          {ride.dropoffAddress || '—'}
        </Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.fareRow}>
          <Banknote size={15} color={colors.success} />
          <Text style={styles.fare}>{inr(ride.fareTotal)}</Text>
          {ride.tipAmount > 0 ? (
            <Text style={styles.tip}>+ {inr(ride.tipAmount)} tip</Text>
          ) : null}
        </View>
        <Text style={styles.time}>{timeAgo(ride.createdAt)}</Text>
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  names: {
    ...typography.bodyBold,
    flex: 1,
  },
  arrowText: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  pills: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  pillGap: {
    marginLeft: 6,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  route: {
    ...typography.meta,
    flexShrink: 1,
  },
  routeArrow: {
    flexShrink: 0,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  fare: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tip: {
    ...typography.meta,
    color: colors.success,
  },
  time: {
    ...typography.meta,
  },
});
