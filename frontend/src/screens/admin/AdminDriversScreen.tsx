import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { colors, typography } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { adminApi, ApplicationSummary } from '../../api/admin';
import { getApiError } from '../../api/client';

export const AdminDriversScreen: React.FC = () => {
  const [items, setItems] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [approved, suspended] = await Promise.all([
        adminApi.list({ status: 'approved', page: 1, limit: 50 }),
        adminApi.list({ status: 'suspended', page: 1, limit: 50 }),
      ]);
      setItems([...approved.items, ...suspended.items]);
    } catch (err) {
      Alert.alert('Failed to load drivers', getApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const suspend = (id: string, name: string) => {
    Alert.alert('Suspend driver?', `${name} will be forced offline immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Suspend',
        style: 'destructive',
        onPress: async () => {
          try {
            // Phase 4 replaces this screen with a reason modal; interim
            // default keeps the endpoint (reason now required) working.
            await adminApi.suspend(id, 'Suspended from admin console');
            load();
          } catch (err) {
            Alert.alert('Suspend failed', getApiError(err));
          }
        },
      },
    ]);
  };

  const reinstate = (id: string, name: string) => {
    Alert.alert('Reinstate driver?', `${name} will be able to go online again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reinstate',
        onPress: async () => {
          try {
            await adminApi.reinstate(id);
            load();
          } catch (err) {
            Alert.alert('Reinstate failed', getApiError(err));
          }
        },
      },
    ]);
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
      <Text style={styles.header}>Drivers</Text>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.empty}>No approved drivers</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.name}>{item.applicantName}</Text>
            <Text style={styles.sub}>{item.phone} · {item.carModel} · {item.plateNumber} · {item.status}</Text>
            {item.status === 'suspended' ? (
              <Button title="Reinstate" onPress={() => reinstate(item.id, item.applicantName)} style={styles.btn} />
            ) : (
              <Button title="Suspend" variant="danger" onPress={() => suspend(item.id, item.applicantName)} style={styles.btn} />
            )}
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
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  empty: { ...typography.body, color: colors.textMuted },
  card: { gap: 6 },
  name: { ...typography.cardTitle, fontSize: 16 },
  sub: { ...typography.meta, fontSize: 12 },
  btn: { marginTop: 8 },
});
