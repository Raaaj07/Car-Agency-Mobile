import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { Card } from '../primitives/Card';
import { Avatar } from '../primitives/Avatar';
import { Pill } from '../primitives/Pill';
import { StatusPill } from './StatusPill';
import { ApplicationStatus } from '../../api/admin';
import { colors, typography } from '../../theme/theme';
import { timeAgo } from '../../utils/format';

export interface DriverRowData {
  id: string;
  applicantName: string;
  phone: string;
  avatar?: string | null;
  status: ApplicationStatus;
  vehicleType: string;
  carModel: string;
  plateNumber: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  rating?: number;
  totalTrips?: number;
  isOnline?: boolean;
}

interface DriverRowProps {
  driver: DriverRowData;
  onPress?: () => void;
}

/** Driver/application row card (spec §3.2 AdminDriversScreen row). */
export const DriverRow: React.FC<DriverRowProps> = ({ driver, onPress }) => {
  const showStats = driver.status === 'approved' && driver.rating !== undefined;
  const waiting = driver.status === 'pending';

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.row}>
        <Avatar
          name={driver.applicantName}
          uri={driver.avatar ?? undefined}
          size={46}
          online={driver.isOnline}
        />
        <View style={styles.main}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>
              {driver.applicantName}
            </Text>
            <StatusPill kind="application" value={driver.status} />
          </View>

          <Text style={styles.phone} numberOfLines={1}>
            {driver.phone}
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {[driver.carModel, driver.plateNumber].filter(Boolean).join(' · ')}
            </Text>
            <Pill label={driver.vehicleType} variant="outline" style={styles.typePill} />
          </View>

          {waiting ? (
            <Text style={styles.waiting}>
              Waiting {timeAgo(driver.submittedAt, { suffix: false })}
            </Text>
          ) : null}
          {!waiting && showStats ? (
            <View style={styles.statsRow}>
              <Star size={13} color={colors.accent} fill={colors.accent} />
              <Text style={styles.statsText}>
                {Number(driver.rating).toFixed(1)} · {driver.totalTrips ?? 0} trips
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  main: {
    flex: 1,
    marginLeft: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    ...typography.bodyBold,
    flex: 1,
    marginRight: 8,
  },
  phone: {
    ...typography.meta,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  meta: {
    ...typography.metaBold,
    flexShrink: 1,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  waiting: {
    ...typography.meta,
    color: colors.accent,
    marginTop: 6,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  statsText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
});
