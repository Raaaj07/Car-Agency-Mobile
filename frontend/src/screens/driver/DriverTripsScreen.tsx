import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { ridesApi, Ride } from '../../api/rides';
import { getApiError } from '../../api/client';

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
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

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

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Trip History</Text>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
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
            <Text style={styles.emptySub}>Rides you complete will show up here.</Text>
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
              <Text style={styles.fareText}>₹{item.fareBreakdown.total.toFixed(2)}</Text>
              {!!item.tipAmount && <Text style={styles.tipText}>+₹{item.tipAmount} tip</Text>}
            </View>
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
});