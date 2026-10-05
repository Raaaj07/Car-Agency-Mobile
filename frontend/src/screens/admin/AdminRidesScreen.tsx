import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminRidesStackParamList } from '../../navigation/types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { FilterChips } from '../../components/admin/FilterChips';
import { SearchBar } from '../../components/admin/SearchBar';
import { RideRow } from '../../components/admin/RideRow';
import { SkeletonList } from '../../components/admin/SkeletonList';
import { ErrorState } from '../../components/admin/ErrorState';
import { EmptyState } from '../../components/admin/EmptyState';
import { Button } from '../../components/primitives/Button';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';
import { adminApi, AdminRideSummary, PaymentStatus, RideStatus } from '../../api/admin';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { useAdminStore } from '../../store/adminStore';
import { colors, typography } from '../../theme/theme';
import { formatDateIST } from '../../utils/format';

type Props = NativeStackScreenProps<AdminRidesStackParamList, 'AdminRides'>;

type StatusKey = 'all' | 'active' | 'completed' | 'cancelled';
type PaymentKey = 'all' | 'paid' | 'unpaid';
type DateKey = 'all' | 'today' | '7d' | 'custom';

const STATUS_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** Unpaid = every non-paid state an operator can still collect on (spec §3.2). */
const PAYMENT_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'unpaid', label: 'Unpaid' },
];

const DATE_CHIPS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: 'custom', label: 'Custom' },
];

const ACTIVE_STATUSES: RideStatus[] = ['requested', 'matched', 'driver_en_route', 'in_progress'];
const UNPAID_STATUSES: PaymentStatus[] = ['pending', 'rider_claimed', 'disputed', 'failed'];

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Midnight IST of the calendar day `daysAgo` days back, as an ISO string. */
function istMidnightIso(daysAgo: number): string {
  const shifted = new Date(Date.now() + IST_OFFSET_MS);
  const dayUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - daysAgo,
  );
  return new Date(dayUtc - IST_OFFSET_MS).toISOString();
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse two `YYYY-MM-DD` IST days into a UTC from/to range (null if invalid). */
function istDayRange(fromStr: string, toStr: string): { from: string; to: string } | null {
  if (!ISO_DAY.test(fromStr) || !ISO_DAY.test(toStr)) return null;
  const from = new Date(`${fromStr}T00:00:00+05:30`);
  const to = new Date(`${toStr}T23:59:59+05:30`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from.getTime() > to.getTime()) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Admin "Rides" tab (spec §3.2): status/payment/date chip filters (comma-list
 * backend query), 300 ms debounced search, infinite scroll, pull-to-refresh
 * and a tap-through to the ride detail screen. Rows refetch after any admin
 * mutation elsewhere (A-6) via the admin store's dataSeq.
 */
export const AdminRidesScreen: React.FC<Props> = ({ navigation, route }) => {
  const dataSeq = useAdminStore((s) => s.dataSeq);
  const tabSpace = useTabBarSpace();

  // Overview stat-card tap-through params apply at mount and whenever the
  // params object identity changes (React's guarded render-phase adjustment).
  const params = route.params;
  const [appliedParams, setAppliedParams] = useState(params);
  const [statusKey, setStatusKey] = useState<StatusKey>(params?.status ?? 'all');
  const [paymentKey, setPaymentKey] = useState<PaymentKey>(params?.payment ?? 'all');
  const [dateKey, setDateKey] = useState<DateKey>(params?.date ?? 'all');
  const [query, setQuery] = useState('');
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 300);

  if (appliedParams !== params) {
    setAppliedParams(params);
    if (params?.status) setStatusKey(params.status);
    if (params?.payment) setPaymentKey(params.payment);
    if (params?.date) setDateKey(params.date);
  }

  const from =
    dateKey === 'today'
      ? istMidnightIso(0)
      : dateKey === '7d'
        ? istMidnightIso(6)
        : dateKey === 'custom'
          ? (customRange?.from ?? null)
          : null;
  const to = dateKey === 'custom' ? (customRange?.to ?? null) : null;

  const list = usePaginatedList<AdminRideSummary>(
    async (page) => {
      const status: RideStatus[] | undefined =
        statusKey === 'all'
          ? undefined
          : statusKey === 'active'
            ? ACTIVE_STATUSES
            : [statusKey];
      const paymentStatus: PaymentStatus[] | undefined =
        paymentKey === 'all'
          ? undefined
          : paymentKey === 'paid'
            ? ['paid']
            : UNPAID_STATUSES;
      const res = await adminApi.listRides({
        status,
        paymentStatus,
        from: from ?? undefined,
        to: to ?? undefined,
        q: debouncedQuery.trim() || undefined,
        page,
        limit: 20,
      });
      return { items: res.items, total: res.total };
    },
    [statusKey, paymentKey, dateKey, from, to, debouncedQuery, dataSeq],
  );

  const applyCustom = () => {
    const range = istDayRange(fromText.trim(), toText.trim());
    if (!range) {
      setDateError('Enter both days as YYYY-MM-DD, from ≤ to.');
      return;
    }
    setDateError(null);
    setCustomRange(range);
  };

  const onDateChange = (key: string) => {
    setDateKey(key as DateKey);
    if (key !== 'custom') {
      setCustomRange(null);
      setDateError(null);
    }
  };

  const clearFilters = () => {
    setStatusKey('all');
    setPaymentKey('all');
    setDateKey('all');
    setCustomRange(null);
    setDateError(null);
    setQuery('');
  };

  const hasFilters =
    statusKey !== 'all' || paymentKey !== 'all' || dateKey !== 'all' || debouncedQuery.trim() !== '';

  const renderEmpty = () => {
    if (list.loading) return <SkeletonList count={5} />;
    if (list.error && list.items.length === 0) {
      return <ErrorState message={list.error} onRetry={list.refresh} />;
    }
    if (debouncedQuery.trim()) {
      return (
        <EmptyState
          title={`No rides match "${debouncedQuery.trim()}"`}
          message="Try another rider, driver, plate or destination."
          action={<Button title="Clear search" variant="outline" size="small" onPress={() => setQuery('')} />}
        />
      );
    }
    if (hasFilters) {
      return (
        <EmptyState
          title="No rides match these filters"
          message="Adjust the status, payment or date filter to widen the search."
          action={<Button title="Clear filters" variant="outline" size="small" onPress={clearFilters} />}
        />
      );
    }
    return <EmptyState title="No rides yet" message="Rides will appear here as soon as they are requested." />;
  };

  return (
    <View style={styles.container}>
      <AdminHeader
        variant="hero"
        title="Rides"
        subtitle={list.total > 0 ? `${list.total} rides` : 'Every ride, newest first'}
      />
      <FlatList
        data={list.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: tabSpace + 16 }]}
        refreshControl={
          <RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={colors.primary} />
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={styles.controls}>
            <Text style={styles.filterLabel}>Status</Text>
            <FilterChips options={STATUS_CHIPS} value={statusKey} onChange={(k) => setStatusKey(k as StatusKey)} />
            <Text style={styles.filterLabel}>Payment</Text>
            <FilterChips options={PAYMENT_CHIPS} value={paymentKey} onChange={(k) => setPaymentKey(k as PaymentKey)} />
            <Text style={styles.filterLabel}>Date (IST)</Text>
            <FilterChips options={DATE_CHIPS} value={dateKey} onChange={onDateChange} />
            {dateKey === 'custom' ? (
              <View style={styles.customCard}>
                <View style={styles.customRow}>
                  <TextInput
                    style={styles.dateInput}
                    value={fromText}
                    onChangeText={setFromText}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textMuted}
                    maxLength={10}
                    autoCapitalize="none"
                  />
                  <TextInput
                    style={styles.dateInput}
                    value={toText}
                    onChangeText={setToText}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textMuted}
                    maxLength={10}
                    autoCapitalize="none"
                  />
                  <Button title="Apply" size="small" onPress={applyCustom} />
                </View>
                <Text style={dateError ? styles.dateError : styles.dateHint}>
                  {dateError ?? `Local time today: ${formatDateIST(new Date())}`}
                </Text>
              </View>
            ) : null}
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder="Search rider, driver, plate or place"
              style={styles.search}
            />
          </View>
        }
        ListEmptyComponent={renderEmpty()}
        ListFooterComponent={
          list.loadingMore ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null
        }
        renderItem={({ item }) => (
          <RideRow ride={item} onPress={() => navigation.navigate('AdminRideDetail', { rideId: item.id })} />
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
    gap: 12,
  },
  controls: {
    marginBottom: 2,
    gap: 8,
  },
  filterLabel: {
    ...typography.metaBold,
    color: colors.textSecondary,
    marginTop: 4,
  },
  customCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: 12,
    gap: 8,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  dateHint: {
    ...typography.meta,
    color: colors.textMuted,
  },
  dateError: {
    ...typography.meta,
    color: colors.danger,
  },
  search: {
    marginTop: 6,
    marginBottom: 4,
  },
  more: {
    marginVertical: 14,
  },
});
