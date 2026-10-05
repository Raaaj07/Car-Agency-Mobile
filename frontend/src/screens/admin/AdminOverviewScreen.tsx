import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Banknote, Car, FileText, IndianRupee, Navigation, Users } from 'lucide-react-native';
import {
  AdminOverviewStackParamList,
  AdminRidesPreset,
  AdminTabParamList,
  AdminDriversSegment,
} from '../../navigation/types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { StatCard } from '../../components/admin/StatCard';
import { DriverRow } from '../../components/admin/DriverRow';
import { RideRow } from '../../components/admin/RideRow';
import { SkeletonList } from '../../components/admin/SkeletonList';
import { ErrorState } from '../../components/admin/ErrorState';
import { EmptyState } from '../../components/admin/EmptyState';
import { StatusPill } from '../../components/admin/StatusPill';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';
import { adminApi, AdminOverview, AuditEntry } from '../../api/admin';
import { getApiError } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useAdminStore } from '../../store/adminStore';
import { AUDIT_ACTION_LABEL } from '../../utils/audit';
import { colors, typography } from '../../theme/theme';
import { formatDateIST, inr, timeAgo } from '../../utils/format';

type Props = NativeStackScreenProps<AdminOverviewStackParamList, 'AdminOverview'>;

/** Greeting on the operator's clock (R-6: Asia/Kolkata). */
function istGreeting(): string {
  const hour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count !== undefined ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

/**
 * Admin dashboard (spec §3.2): greeting hero, six tap-through stat cards,
 * "Needs attention" (oldest pending / stuck rides / completed-but-unpaid) and
 * a "Recent activity" feed from the paginated GET /admin/audit endpoint
 * (latest 10, target display names, own loading/empty/error states).
 * Refetches on new-application socket events and after any admin mutation.
 */
export const AdminOverviewScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore((s) => s.user);
  const newSeq = useAdminStore((s) => s.newApplicationSeq);
  const dataSeq = useAdminStore((s) => s.dataSeq);
  const tabSpace = useTabBarSpace();

  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Latest 10 audit entries — separate call so the feed has its own skeleton,
  // empty state and retry, and shows target display names.
  const [activity, setActivity] = useState<AuditEntry[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  // Promise callbacks only — direct setState inside the effect body trips
  // react-hooks/set-state-in-effect (A-9 pattern), so the chain is inline.
  useEffect(() => {
    let live = true;
    adminApi
      .overview()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
        // Keep the Drivers-tab badge honest even if a socket event was missed.
        useAdminStore.getState().setPendingCount(d.applications.pending);
      })
      .catch((err) => {
        if (live) setError(getApiError(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [newSeq, dataSeq]);

  // Same trigger set as the overview: mount, new-application events, mutations.
  useEffect(() => {
    let live = true;
    adminApi
      .audit({ page: 1, limit: 10 })
      .then((page) => {
        if (!live) return;
        setActivity(page.items);
        setActivityError(null);
      })
      .catch((err) => {
        if (live) setActivityError(getApiError(err));
      })
      .finally(() => {
        if (live) setActivityLoading(false);
      });
    return () => {
      live = false;
    };
  }, [newSeq, dataSeq]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    adminApi
      .overview()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(getApiError(err)))
      .finally(() => {
        adminApi
          .audit({ page: 1, limit: 10 })
          .then((page) => {
            setActivity(page.items);
            setActivityError(null);
          })
          .catch((err) => setActivityError(getApiError(err)))
          .finally(() => setRefreshing(false));
      });
  }, []);

  const retryActivity = useCallback(() => {
    setActivityLoading(true);
    setActivityError(null);
    adminApi
      .audit({ page: 1, limit: 10 })
      .then((page) => {
        setActivity(page.items);
        setActivityError(null);
      })
      .catch((err) => setActivityError(getApiError(err)))
      .finally(() => setActivityLoading(false));
  }, []);

  const onRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .overview()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(getApiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const tabNav = navigation.getParent<BottomTabNavigationProp<AdminTabParamList>>();
  const openDrivers = (segment: AdminDriversSegment) =>
    tabNav?.navigate('drivers', { screen: 'AdminDrivers', params: { segment } });
  const openRides = (preset: AdminRidesPreset) =>
    tabNav?.navigate('rides', { screen: 'AdminRides', params: preset });
  const openDriver = (driverId: string) =>
    tabNav?.navigate('drivers', { screen: 'AdminDriverDetail', params: { driverId } });
  const openRide = (rideId: string) =>
    tabNav?.navigate('rides', { screen: 'AdminRideDetail', params: { rideId } });

  const firstName = (user?.name || 'Admin').trim().split(' ')[0];
  const attentionCount = data
    ? data.attention.oldestPending.length +
      data.attention.stuckRides.length +
      data.attention.unpaidRides.length
    : 0;

  return (
    <View style={styles.container}>
      <AdminHeader
        variant="hero"
        greeting={istGreeting()}
        title={firstName}
        subtitle={formatDateIST(new Date())}
        right={<Avatar name={user?.name ?? 'Admin'} uri={user?.avatar} size={40} />}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace + 16 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {loading && !data ? (
          <SkeletonList count={3} rowHeight={110} />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : data ? (
          <>
            <View style={styles.grid}>
              <StatCard
                label="Pending applications"
                value={data.applications.pending}
                tone="amber"
                highlighted={data.applications.pending > 0}
                icon={<FileText size={18} color={colors.accent} />}
                onPress={() => openDrivers('pending')}
                style={styles.cell}
              />
              <StatCard
                label="Online drivers"
                value={data.drivers.online}
                icon={<Users size={18} color={colors.success} />}
                onPress={() => openDrivers('approved')}
                style={styles.cell}
              />
              <StatCard
                label="Active rides"
                value={data.rides.active}
                icon={<Navigation size={18} color={colors.primary} />}
                onPress={() => openRides({ status: 'active' })}
                style={styles.cell}
              />
              <StatCard
                label={"Today's rides"}
                value={data.rides.today}
                icon={<Car size={18} color={colors.primary} />}
                onPress={() => openRides({ date: 'today' })}
                style={styles.cell}
              />
              <StatCard
                label={"Today's gross fare"}
                value={inr(data.fares.today)}
                tone="success"
                icon={<IndianRupee size={18} color={colors.success} />}
                onPress={() => openRides({ date: 'today' })}
                style={styles.cell}
              />
              <StatCard
                label="Unpaid completed rides"
                value={data.rides.completedUnpaid}
                tone={data.rides.completedUnpaid > 0 ? 'danger' : 'neutral'}
                icon={<Banknote size={18} color={colors.danger} />}
                onPress={() => openRides({ payment: 'unpaid' })}
                style={styles.cell}
              />
            </View>

            <SectionTitle title="Needs attention" count={attentionCount} />
            {attentionCount === 0 ? (
              <EmptyState
                title="All caught up"
                message="No pending applications, stuck rides or unpaid trips right now."
              />
            ) : (
              <>
                {data.attention.oldestPending.map((application) => (
                  <DriverRow
                    key={application.id}
                    driver={application}
                    onPress={() => openDriver(application.id)}
                  />
                ))}
                {data.attention.stuckRides.map((ride) => (
                  <Card
                    key={ride.id}
                    style={styles.attentionCard}
                    onPress={() => openRide(ride.id)}
                  >
                    <View style={styles.attentionHead}>
                      <StatusPill kind="ride" value={ride.status} />
                      <Text style={styles.attentionTime}>{timeAgo(ride.createdAt)}</Text>
                    </View>
                    <Text style={styles.attentionBody} numberOfLines={1}>
                      {ride.riderName} · waiting{' '}
                      {timeAgo(ride.matchedAt ?? ride.createdAt, { suffix: false })}
                    </Text>
                  </Card>
                ))}
                {data.attention.unpaidRides.map((ride) => (
                  <RideRow key={ride.id} ride={ride} onPress={() => openRide(ride.id)} />
                ))}
              </>
            )}

            <SectionTitle title="Recent activity" count={activity?.length} />
            {activityLoading && !activity ? (
              <SkeletonList count={3} rowHeight={76} />
            ) : activityError && !activity ? (
              <ErrorState message={activityError} onRetry={retryActivity} />
            ) : activity && activity.length === 0 ? (
              <EmptyState
                title="No activity yet"
                message="Approvals, suspensions and payment resolutions will show up here."
              />
            ) : (
              activity?.map((entry) => (
                <Card
                  key={entry.id}
                  style={styles.activityCard}
                  onPress={() =>
                    entry.targetType === 'driver'
                      ? openDriver(entry.targetId)
                      : openRide(entry.targetId)
                  }
                >
                  <View style={styles.activityHead}>
                    <Text style={styles.activityAction} numberOfLines={1}>
                      {AUDIT_ACTION_LABEL[entry.action]}
                    </Text>
                    <Text style={styles.activityTime}>{timeAgo(entry.createdAt)}</Text>
                  </View>
                  <Text style={styles.activityTarget} numberOfLines={1}>
                    {entry.targetType === 'driver' ? 'Driver' : 'Ride'} ·{' '}
                    {entry.targetName ?? `#${entry.targetId.slice(0, 8)}`}
                  </Text>
                  <Text style={styles.activityMeta} numberOfLines={2}>
                    {(entry.actorName ?? 'System') +
                      (entry.reason ? ` — ${entry.reason}` : '')}
                  </Text>
                </Card>
              ))
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  cell: {
    width: '48%',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: {
    ...typography.cardTitle,
  },
  sectionCount: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  attentionCard: {
    marginBottom: 10,
  },
  attentionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attentionTime: {
    ...typography.meta,
    color: colors.textMuted,
  },
  attentionBody: {
    ...typography.bodyBold,
    fontSize: 14,
    marginTop: 8,
  },
  activityCard: {
    marginBottom: 10,
  },
  activityHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  activityAction: {
    ...typography.bodyBold,
    flex: 1,
  },
  activityTime: {
    ...typography.meta,
    color: colors.textMuted,
  },
  activityTarget: {
    ...typography.bodyBold,
    fontSize: 14,
    marginTop: 6,
  },
  activityMeta: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: 4,
  },
});
