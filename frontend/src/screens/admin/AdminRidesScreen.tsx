import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { colors, typography } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { adminApi, AdminRideSummary } from '../../api/admin';
import { getApiError } from '../../api/client';

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'primary' | 'warning' | 'muted'> = {
  completed: 'success',
  cancelled: 'danger',
  in_progress: 'primary',
  driver_en_route: 'primary',
  matched: 'warning',
  requested: 'warning',
};

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

/**
 * Admin "Rides" tab: every ride, newest first, with fare and — critically —
 * the payment-collection flag the driver sets via "Amount Received".
 */
export const AdminRidesScreen: React.FC = () => {
  const [items, setItems] = useState<AdminRideSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.listRides(1, 50);
      setItems(res.items);
    } catch (err) {
      Alert.alert('Failed to load rides', getApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch via promise callbacks (no sync setState in the effect);
    // refreshes reuse load() from the pull-to-refresh handler.
    adminApi
      .listRides(1, 50)
      .then((res) => setItems(res.items))
      .catch((err) => Alert.alert('Failed to load rides', getApiError(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Rides</Text>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.empty}>No rides yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const paid = item.paymentStatus === 'paid';
          return (
            <Card style={styles.card}>
              <View style={styles.pillRow}>
                <Pill label={item.status.replace('_', ' ').toUpperCase()} variant={STATUS_VARIANT[item.status] ?? 'muted'} />
                <Pill label={paid ? 'PAID' : 'PENDING'} variant={paid ? 'success' : 'warning'} />
              </View>
              <Text style={styles.route} numberOfLines={2}>
                {item.pickupAddress || 'Pickup'} → {item.dropoffAddress || 'Drop-off'}
              </Text>
              <Text style={styles.sub}>
                {item.riderName} → {item.driverName} · {item.vehicleType}
              </Text>
              <View style={styles.fareRow}>
                <Text style={styles.fare}>
                  ₹{item.fareTotal.toFixed(2)}
                  {item.tipAmount > 0 ? ` (+₹${item.tipAmount.toFixed(2)} tip)` : ''}
                </Text>
                <Text style={styles.date}>{formatDate(item.completedAt ?? item.createdAt)}</Text>
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { ...typography.heading, fontSize: 22, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  empty: { ...typography.body, color: colors.textMuted },
  card: { gap: 6 },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  route: { ...typography.cardTitle, fontSize: 15 },
  sub: { ...typography.meta, fontSize: 12 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fare: { ...typography.bodyBold, fontSize: 14, color: colors.primary },
  date: { ...typography.meta, fontSize: 11, color: colors.textMuted },
});
