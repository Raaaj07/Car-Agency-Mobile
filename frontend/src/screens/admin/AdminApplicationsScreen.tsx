import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { adminApi, ApplicationStatus, ApplicationSummary } from '../../api/admin';
import { getApiError } from '../../api/client';

const FILTERS: (ApplicationStatus | undefined)[] = [undefined, 'pending', 'approved', 'rejected'];

interface Props {
  onOpen: (id: string) => void;
}

export const AdminApplicationsScreen: React.FC<Props> = ({ onOpen }) => {
  const [filter, setFilter] = useState<ApplicationStatus | undefined>('pending');
  const [items, setItems] = useState<ApplicationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (p = 1, append = false) => {
      try {
        const res = await adminApi.list({ status: filter, page: p, limit: 20 });
        setTotal(res.total);
        setPage(p);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      } catch (err) {
        Alert.alert('Failed to load applications', getApiError(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    setLoading(true);
    load(1, false);
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ShieldCheck size={22} color={colors.primary} />
        <Text style={styles.header}>Applications</Text>
        <Text style={styles.count}>{total}</Text>
      </View>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f ?? 'all'}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f ? f[0].toUpperCase() + f.slice(1) : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(1, false); }} />
          }
          onEndReached={() => {
            if (!loadingMore && items.length < total) {
              setLoadingMore(true);
              load(page + 1, true);
            }
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.empty}>No applications</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => onOpen(item.id)} activeOpacity={0.8}>
              <Card style={styles.card}>
                <View style={styles.top}>
                  <View>
                    <Text style={styles.name}>{item.applicantName}</Text>
                    <Text style={styles.sub}>{item.phone}</Text>
                  </View>
                  <Pill label={item.status} variant={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'} />
                </View>
                <Text style={styles.vehicle}>{item.carModel} · {item.plateNumber} · {item.vehicleType.toUpperCase()}</Text>
              </Card>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  header: { ...typography.heading, fontSize: 22, flex: 1 },
  count: { ...typography.metaBold, color: colors.textMuted },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9' },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...typography.bodyBold, fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  empty: { ...typography.body, color: colors.textMuted },
  card: { gap: 6 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { ...typography.cardTitle, fontSize: 16 },
  sub: { ...typography.meta, fontSize: 12 },
  vehicle: { ...typography.meta, fontSize: 12 },
});
