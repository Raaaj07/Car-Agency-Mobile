import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminDriversStackParamList, AdminDriversSegment } from '../../navigation/types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { SegmentedControl } from '../../components/admin/SegmentedControl';
import { SearchBar } from '../../components/admin/SearchBar';
import { DriverRow } from '../../components/admin/DriverRow';
import { SkeletonList } from '../../components/admin/SkeletonList';
import { ErrorState } from '../../components/admin/ErrorState';
import { EmptyState } from '../../components/admin/EmptyState';
import { Button } from '../../components/primitives/Button';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';
import { adminApi, ApplicationCounts, ApplicationSummary } from '../../api/admin';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { useAdminStore } from '../../store/adminStore';
import { colors, radii, typography } from '../../theme/theme';

type Props = NativeStackScreenProps<AdminDriversStackParamList, 'AdminDrivers'>;

const EMPTY_COPY: Record<AdminDriversSegment, { title: string; message: string }> = {
  pending: { title: 'No pending applications', message: 'New driver applications land here.' },
  approved: { title: 'No active drivers', message: 'Approved drivers will appear in this list.' },
  suspended: { title: 'No suspended drivers', message: 'Suspended drivers are kept here.' },
  rejected: { title: 'No rejected applications', message: 'Rejected applications are kept here.' },
};

/**
 * Admin "Drivers" tab (spec §3.2): segmented queue with counts, 300 ms
 * debounced search (name/phone/plate/model), oldest-first pending sort,
 * infinite scroll, pull-to-refresh and per-segment empty states. Rows are
 * always tappable (A-4) and the list refetches when a new application socket
 * event arrives or after an action on the detail screen (A-6/A-11).
 */
export const AdminDriversScreen: React.FC<Props> = ({ navigation, route }) => {
  const newSeq = useAdminStore((s) => s.newApplicationSeq);
  const dataSeq = useAdminStore((s) => s.dataSeq);
  const tabSpace = useTabBarSpace();

  // Overview stat-card tap-through: params apply at mount and whenever the
  // params object identity changes (React's documented "adjust state when
  // props change" pattern — no effect needed, no lint violation).
  const params = route.params;
  const [appliedParams, setAppliedParams] = useState(params);
  const [segment, setSegment] = useState<AdminDriversSegment>(params?.segment ?? 'pending');
  // "Online now": only the active drivers who are online right now (the Overview
  // "Online drivers" card opens the list this way, so its number matches the list).
  const [onlineOnly, setOnlineOnly] = useState<boolean>(!!params?.online);
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<ApplicationCounts | null>(null);
  const debouncedQuery = useDebouncedValue(query, 300);

  if (appliedParams !== params) {
    setAppliedParams(params);
    if (params?.segment) setSegment(params.segment);
    setOnlineOnly(!!params?.online);
  }

  const onlineFilter = segment === 'approved' && onlineOnly;

  const list = usePaginatedList<ApplicationSummary>(
    async (page) => {
      const res = await adminApi.list({
        status: segment,
        online: onlineFilter || undefined,
        q: debouncedQuery.trim() || undefined,
        // Pending queue: oldest waiter first (A-10); everything else newest.
        sort: segment === 'pending' ? 'oldest' : 'newest',
        page,
        limit: 20,
      });
      return { items: res.items, total: res.total };
    },
    [segment, onlineFilter, debouncedQuery, newSeq, dataSeq],
  );

  // Counts feed the segmented badges AND the tab badge; refetch when a new
  // application arrives or any admin action changed a status.
  useEffect(() => {
    let live = true;
    adminApi
      .counts()
      .then((c) => {
        if (!live) return;
        setCounts(c);
        useAdminStore.getState().setPendingCount(c.pending);
      })
      .catch(() => {
        // Counts are decoration — a failed fetch must not break the list.
      });
    return () => {
      live = false;
    };
  }, [newSeq, dataSeq]);

  const segmentOptions = [
    { key: 'pending', label: 'Pending', count: counts?.pending },
    { key: 'approved', label: 'Active', count: counts?.approved },
    { key: 'suspended', label: 'Suspended', count: counts?.suspended },
    { key: 'rejected', label: 'Rejected', count: counts?.rejected },
  ];

  const renderEmpty = () => {
    if (list.loading) return <SkeletonList count={5} />;
    if (list.error) return <ErrorState message={list.error} onRetry={list.refresh} />;
    if (query.trim()) {
      return (
        <EmptyState
          title={`No matches for "${query.trim()}"`}
          message="Try a different name, phone number or plate."
          action={
            <Button title="Clear search" variant="outline" size="small" onPress={() => setQuery('')} />
          }
        />
      );
    }
    if (onlineFilter) {
      return (
        <EmptyState title="No drivers online" message="Drivers who are online right now appear here." />
      );
    }
    return <EmptyState title={EMPTY_COPY[segment].title} message={EMPTY_COPY[segment].message} />;
  };

  return (
    <View style={styles.container}>
      <AdminHeader
        variant="hero"
        title="Drivers"
        subtitle={
          counts
            ? `${counts.pending} pending · ${counts.approved} active · ${counts.total} total`
            : 'Applications and active drivers'
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: tabSpace + 16 }]}
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={list.refresh}
            tintColor={colors.primary}
          />
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={styles.controls}>
            <SegmentedControl
              options={segmentOptions}
              value={segment}
              onChange={(key) => {
                setSegment(key as AdminDriversSegment);
                // "Online now" only exists on the Active list.
                if (key !== 'approved') setOnlineOnly(false);
              }}
            />
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder="Search name, phone or plate"
              style={styles.search}
            />
            {segment === 'approved' ? (
              <TouchableOpacity
                style={[styles.chip, onlineOnly && styles.chipActive]}
                onPress={() => setOnlineOnly((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ selected: onlineOnly }}
                accessibilityLabel="Show only drivers who are online now"
              >
                <View style={[styles.onlineDot, onlineOnly && styles.onlineDotActive]} />
                <Text style={[styles.chipText, onlineOnly && styles.chipTextActive]}>Online now</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        ListEmptyComponent={renderEmpty()}
        ListFooterComponent={
          list.loadingMore ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null
        }
        renderItem={({ item }) => (
          <DriverRow
            driver={item}
            onPress={() => navigation.navigate('AdminDriverDetail', { driverId: item.id })}
          />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  controls: {
    marginBottom: 14,
    gap: 10,
  },
  search: {
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },
  onlineDotActive: {
    backgroundColor: colors.success,
  },
  more: {
    marginVertical: 14,
  },
});
