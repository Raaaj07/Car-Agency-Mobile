import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MapPin } from 'lucide-react-native';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';
import { colors, typography } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { Button } from '../../components/primitives/Button';
import { ridesApi, Ride } from '../../api/rides';
import { getApiError } from '../../api/client';
import { driverPaymentBadge } from '../../utils/paymentState';

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'primary' | 'muted'> = {
  completed: 'success',
  cancelled: 'danger',
  in_progress: 'primary',
  driver_en_route: 'primary',
  matched: 'warning',
  requested: 'warning',
};

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export const DriverTripsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const tabBarSpace = useTabBarSpace();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // The trip whose "Amount Received" request is in flight (one at a time).
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const { items } = await ridesApi.list(1, 30, 'driver');
      setRides(items);
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload every time the tab is focused: a trip the driver just finished must
  // be there when they open Trips (the tab stays mounted, so a mount-only
  // fetch left the list stale until a manual pull-to-refresh).
  useFocusEffect(
    useCallback(() => {
      // Async boundary: load() clears the error synchronously before its first
      // await, which trips react-hooks/set-state-in-effect — a microtask
      // deferral keeps the fetch timing visually identical.
      void Promise.resolve().then(load);
    }, [load]),
  );

  // A trip whose payment was never confirmed on the payment screen (the driver
  // chose "Continue without confirming", or a newer trip took its place) can be
  // settled here. The server re-checks everything: it refuses a disputed ride,
  // treats a second tap as a no-op and records the confirmation for admin.
  const markReceived = async (ride: Ride) => {
    if (markingId) return;
    setMarkingId(ride.id);
    try {
      const updated = await ridesApi.markPaymentReceived(ride.id);
      setRides((current) =>
        current.map((r) => (r.id === ride.id ? { ...r, paymentStatus: updated.paymentStatus } : r)),
      );
    } catch (err) {
      Alert.alert('Unable to update payment', getApiError(err));
    } finally {
      setMarkingId(null);
    }
  };

  const confirmReceived = (ride: Ride) => {
    const amount = Number(ride.fareBreakdown?.total ?? 0) + Number(ride.tipAmount ?? 0);
    Alert.alert(
      'Amount received?',
      `Confirm the rider paid ₹${amount.toFixed(2)} for this trip. It is recorded for admin.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Yes, received', onPress: () => void markReceived(ride) },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.header, { paddingTop: insets.top + 16 }]}>Trip History</Text>
      <FlatList
        data={rides}
        // Rows read `markingId` (the button's loading state): tell the list to re-render them.
        extraData={markingId}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          // Let the empty / error state centre itself instead of collapsing to the top.
          rides.length === 0 && styles.listEmpty,
          { paddingBottom: tabBarSpace + 16 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>{error ?? 'No trips yet'}</Text>
            <Text style={styles.emptySub}>
              {error ? 'Check your connection and try again.' : 'Rides you complete will show up here.'}
            </Text>
            {error ? (
              <Button
                title="Try again"
                variant="outline"
                size="medium"
                style={styles.retryBtn}
                onPress={() => {
                  setLoading(true);
                  void load();
                }}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.rideCard}>
            <View style={styles.rideTop}>
              <Text style={styles.rideDate}>{formatDate(item.createdAt)}</Text>
              <Pill label={item.status.replace(/_/g, ' ')} variant={STATUS_VARIANT[item.status] ?? 'muted'} />
            </View>
            <View style={styles.routeRow}>
              <MapPin size={16} color={colors.success} />
              <Text style={styles.routeText} numberOfLines={1}>{item.pickup?.address}</Text>
            </View>
            <View style={styles.routeRow}>
              <MapPin size={16} color={colors.danger} />
              <Text style={styles.routeText} numberOfLines={1}>{item.dropoff?.address}</Text>
            </View>
            <View style={styles.rideFooter}>
              {/* Only a completed trip earned money: a cancelled ride's estimate must not read like earnings. */}
              <Text style={styles.fareText}>
                {item.status === 'completed' && item.fareBreakdown?.total != null
                  ? `₹${item.fareBreakdown.total.toFixed(2)}`
                  : '—'}
              </Text>
              {item.status === 'completed' && !!item.tipAmount && (
                <Text style={styles.tipText}>+₹{item.tipAmount} tip</Text>
              )}
            </View>
            {item.status === 'completed' ? (
              <View style={styles.payRow}>
                <Pill
                  label={driverPaymentBadge(item.paymentStatus).label}
                  variant={driverPaymentBadge(item.paymentStatus).variant}
                />
                {driverPaymentBadge(item.paymentStatus).canMarkReceived ? (
                  <Button
                    title="Amount Received"
                    variant="outline"
                    size="small"
                    loading={markingId === item.id}
                    disabled={markingId !== null}
                    onPress={() => confirmReceived(item)}
                  />
                ) : null}
              </View>
            ) : null}
          </Card>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { ...typography.heading, fontSize: 22, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 },
  listContent: { paddingHorizontal: 20, paddingBottom: 100, gap: 12 },
  listEmpty: { flexGrow: 1 },
  retryBtn: { marginTop: 16, alignSelf: 'center' },
  emptyTitle: { ...typography.bodyBold, marginBottom: 6, textAlign: 'center' },
  emptySub: { ...typography.meta, textAlign: 'center' },
  rideCard: { gap: 8 },
  rideTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rideDate: { ...typography.meta, fontSize: 12 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeText: { ...typography.body, fontSize: 13, flex: 1 },
  rideFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.borderLight },
  fareText: { ...typography.cardTitle, fontSize: 16, color: colors.primary },
  tipText: { ...typography.metaBold, fontSize: 12, color: colors.success },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
});