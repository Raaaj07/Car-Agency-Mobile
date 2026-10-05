import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { LogOut, ShieldCheck } from 'lucide-react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';
import { confirmAction } from '../../components/admin/ConfirmDialog';
import { useAuthStore } from '../../store/authStore';
import { useAdminStore } from '../../store/adminStore';
import { useRideStore } from '../../store/rideStore';
import { colors, typography } from '../../theme/theme';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Admin "Account" tab (spec §3.2): identity card, app/build info and sign-out
 * (with a native confirm, mirroring the rider/driver profile screens).
 */
export const AdminAccountScreen: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const resetRide = useRideStore((s) => s.resetRide);
  const tabSpace = useTabBarSpace();

  const onLogout = async () => {
    const ok = await confirmAction(
      'Sign out?',
      'You will need your phone number and OTP to sign back in.',
      'Sign out',
    );
    if (!ok) return;
    resetRide();
    useAdminStore.getState().reset();
    logout();
  };

  const name = user?.name?.trim() || 'Admin';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={styles.container}>
      <AdminHeader variant="hero" greeting="Signed in" title="Account" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabSpace + 16 }]}>
        <Card style={styles.card}>
          <View style={styles.profileRow}>
            <Avatar name={name} uri={user?.avatar} size={64} />
            <View style={styles.profileText}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.phone}>{user?.phone ?? '—'}</Text>
              <View style={styles.pillRow}>
                <Pill label="Administrator" variant="primary" />
                <ShieldCheck size={16} color={colors.accent} />
              </View>
            </View>
          </View>
          <View style={styles.divider} />
          <InfoRow label="Role" value={user?.role ?? 'admin'} />
          {user?.email ? <InfoRow label="Email" value={user.email} /> : null}
        </Card>

        <Card style={styles.card}>
          <InfoRow label="App version" value={`v${version}`} />
          <InfoRow label="Console timezone" value="Asia/Kolkata (IST)" />
          <InfoRow label="API endpoint" value={process.env.EXPO_PUBLIC_API_URL ?? 'default'} />
        </Card>

        <Button
          title="Sign out"
          variant="outline"
          leftIcon={<LogOut size={18} color={colors.danger} />}
          style={styles.logout}
          onPress={() => void onLogout()}
        />
        <Text style={styles.footnote}>Vazhi admin console</Text>
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
  card: {
    marginBottom: 12,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileText: {
    flex: 1,
    marginLeft: 14,
  },
  name: {
    ...typography.cardTitle,
    fontSize: 18,
  },
  phone: {
    ...typography.meta,
    marginTop: 2,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 5,
  },
  rowLabel: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  rowValue: {
    ...typography.bodyBold,
    fontSize: 14,
    flexShrink: 1,
    textAlign: 'right',
  },
  logout: {
    marginTop: 8,
  },
  footnote: {
    ...typography.meta,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
});
