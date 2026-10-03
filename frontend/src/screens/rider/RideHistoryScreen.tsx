import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MapPin, Star } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { Button } from '../../components/primitives/Button';
import { ridesApi, Ride } from '../../api/rides';
import { getApiError } from '../../api/client';
import { applyRideToStore, isActiveStatus, restoreActiveRide, screenForStatus } from '../../hooks/useActiveRide';

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

// Rider-mode Trips: bookings only. Driven trips live in the driver-mode
// Trips tab (DriverTripsScreen), so no driver toggle appears here.
const TAB = 'rider' as const;

export const RideHistoryScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const { items } = await ridesApi.list(1, 30, TAB);
      setRides(items);
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Silently re-sync the in-memory active ride so Resume works even
      // after an app restart, then reload the list.
      restoreActiveRide()
        .catch(() => null)
        .finally(() => load());
    }, [load]),
  );

  const handleResume = (ride: Ride) => {
    applyRideToStore(ride);
    navigation.navigate('HomeTab', { screen: screenForStatus(ride.status) });
  };

  const handleCancel = (ride: Ride) => {
    applyRideToStore(ride);
    navigation.getParent()?.navigate('CancelRideConfirmation' as never);
  };

  const activeRides = rides.filter((r) => isActiveStatus(r.status));
  // Pinned in the header — never duplicated in the FlatList below.
  const pastRides = rides.filter((r) => !isActiveStatus(r.status));
  const nothingToShow = activeRides.length === 0 && pastRides.length === 0;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>My Trips</Text>
      <FlatList
        data={pastRides}
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
        ListHeaderComponent={
          activeRides.length > 0 ? (
            <View style={styles.activeSection}>
              <Text style={styles.activeTitle}>Active ride</Text>
              {activeRides.map((ride) => (
                <Card key={ride.id} style={styles.activeCard}>
                  <View style={styles.rideTop}>
                    <Text style={styles.rideDate}>{formatDate(ride.createdAt)}</Text>
                    <Pill label={ride.status.replace(/_/g, ' ')} variant={STATUS_VARIANT[ride.status] ?? 'muted'} />
                  </View>
                  <View style={styles.routeRow}>
                    <MapPin size={16} color={colors.success} />
                    <Text style={styles.routeText} numberOfLines={1}>{ride.pickup?.address}</Text>
                  </View>
                  <View style={styles.routeRow}>
                    <MapPin size={16} color={colors.danger} />
                    <Text style={styles.routeText} numberOfLines={1}>{ride.dropoff?.address}</Text>
                  </View>
                  <View style={styles.activeBtnRow}>
                    <Button title="Resume" onPress={() => handleResume(ride)} variant="primary" size="medium" style={styles.resumeBtn} />
                    <Button title="Cancel ride" onPress={() => handleCancel(ride)} variant="outline" size="medium" style={styles.cancelBtn} />
                  </View>
                </Card>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          nothingToShow ? (
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>{error ?? 'No bookings yet'}</Text>
              <Text style={styles.emptySub}>Rides you book will show up here.</Text>
            </View>
          ) : null
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
              {item.rating != null && (
                <View style={styles.ratingRow}>
                  <Star size={14} color={colors.accent} fill={colors.accent} />
                  <Text style={styles.ratingText}>{item.rating}</Text>
                </View>
              )}
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
  header: { ...typography.heading, fontSize: 22, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  listContent: { paddingHorizontal: 20, paddingBottom: 100, gap: 12 },
  emptyTitle: { ...typography.bodyBold, marginBottom: 6, textAlign: 'center' },
  emptySub: { ...typography.meta, textAlign: 'center' },
  activeSection: { gap: 12, marginBottom: 4 },
  activeTitle: { ...typography.bodyBold, fontSize: 15, color: colors.primary },
  activeCard: { gap: 8, borderWidth: 1.5, borderColor: colors.primary },
  activeBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  resumeBtn: { flex: 1 },
  cancelBtn: { flex: 1 },
  rideCard: { gap: 8 },
  rideTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rideDate: { ...typography.meta, fontSize: 12 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeText: { ...typography.body, fontSize: 13, flex: 1 },
  rideFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.borderLight },
  fareText: { ...typography.cardTitle, fontSize: 16, color: colors.primary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { ...typography.metaBold, fontSize: 13 },
});
