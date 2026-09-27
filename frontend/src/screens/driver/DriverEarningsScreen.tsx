import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { colors, typography } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { ridesApi, Ride } from '../../api/rides';
import { getApiError } from '../../api/client';

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const DriverEarningsScreen: React.FC = () => {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const { items } = await ridesApi.list(1, 50);
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

  const completed = rides.filter((r) => r.status === 'completed');
  const totalEarnings = completed.reduce((sum, r) => sum + r.fareBreakdown.total + (r.tipAmount ?? 0), 0);
  const totalTips = completed.reduce((sum, r) => sum + (r.tipAmount ?? 0), 0);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
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
    >
      <Text style={styles.header}>Earnings</Text>

      <Card style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>TOTAL EARNINGS</Text>
        <Text style={styles.summaryAmount}>₹{totalEarnings.toFixed(2)}</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryVal}>{completed.length}</Text>
            <Text style={styles.summaryColLabel}>Completed trips</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCol}>
            <Text style={styles.summaryVal}>₹{totalTips.toFixed(2)}</Text>
            <Text style={styles.summaryColLabel}>Tips earned</Text>
          </View>
        </View>
      </Card>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Text style={styles.sectionTitle}>Recent completed trips</Text>
      {completed.length === 0 ? (
        <Text style={styles.emptySub}>Complete a ride to start earning.</Text>
      ) : (
        completed.map((ride) => (
          <Card key={ride.id} style={styles.tripRow}>
            <View>
              <Text style={styles.tripDate}>{formatDate(ride.completedAt ?? ride.createdAt)}</Text>
              <Text style={styles.tripRoute} numberOfLines={1}>
                {ride.pickup?.address} → {ride.dropoff?.address}
              </Text>
            </View>
            <Text style={styles.tripAmount}>₹{(ride.fareBreakdown.total + (ride.tipAmount ?? 0)).toFixed(2)}</Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 100, gap: 16 },
  header: { ...typography.heading, fontSize: 22 },
  summaryCard: { backgroundColor: colors.primary, padding: 18 },
  summaryLabel: { ...typography.metaBold, fontSize: 10, color: 'rgba(255,255,255,0.7)', letterSpacing: 1 },
  summaryAmount: { ...typography.heading, fontSize: 32, color: colors.accent, marginBottom: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryVal: { ...typography.cardTitle, fontSize: 18, color: '#FFFFFF' },
  summaryColLabel: { ...typography.meta, fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  summaryDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },
  sectionTitle: { ...typography.bodyBold, fontSize: 15 },
  emptySub: { ...typography.meta },
  errorText: { ...typography.meta, color: colors.danger },
  tripRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  tripDate: { ...typography.meta, fontSize: 11, marginBottom: 2 },
  tripRoute: { ...typography.bodyBold, fontSize: 13, maxWidth: 220 },
  tripAmount: { ...typography.cardTitle, fontSize: 15, color: colors.primary },
});