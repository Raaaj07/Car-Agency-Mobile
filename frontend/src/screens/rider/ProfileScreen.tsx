import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, RefreshControl } from 'react-native';
import Constants from 'expo-constants';
import {
  LogOut,
  Edit2,
  Car,
  BadgeCheck,
  Camera,
  AlertCircle,
  PauseCircle,
  QrCode,
  ChevronRight,
  SlidersHorizontal,
  HelpCircle,
  ArrowLeftRight,
  Megaphone,
} from 'lucide-react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { colors, radii, typography } from '../../theme/theme';
import { useAuthStore } from '../../store/authStore';
import { useRideStore } from '../../store/rideStore';
import { authApi } from '../../api/auth';
import { driversApi, DriverApplication } from '../../api/drivers';
import { getApiError } from '../../api/client';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';
import { connectSocket, disconnectSocket } from '../../lib/socket';
import { tokenManager } from '../../lib/tokenManager';

const appVersion = Constants.expoConfig?.version ?? '1.0.0';

// Row shared by both profile layouts (reference design): icon, label
// (+ optional subtitle), chevron. `plain` = bare rider-style icon;
// otherwise the driver-style tinted tile. `danger` colours Sign out.
function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
  danger,
  plain,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
  plain?: boolean;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuRow, !last && styles.menuRowDivider]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <View style={plain ? styles.menuIconPlain : styles.menuIconTile}>{icon}</View>
      <View style={styles.menuTexts}>
        <Text style={[styles.menuTitle, danger && styles.menuDanger]}>{title}</Text>
        {subtitle ? <Text style={styles.menuSub}>{subtitle}</Text> : null}
      </View>
      <ChevronRight size={18} color={danger ? colors.danger : colors.textMuted} />
    </TouchableOpacity>
  );
}

// Single Profile screen for BOTH modes, laid out per the reference designs:
// rider mode shows the compact header card + Rides/Preferences/Help menu;
// driver mode shows the centered header + PREFERENCES/ACCOUNT sections
// (announcements, vehicle, payment QR, support). The driverStatus section
// still reflects server truth: none → Become a driver; pending/rejected/
// suspended → status cards; approved → Switch to Driver.
export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateUser = useAuthStore((s) => s.updateUser);
  const setActiveMode = useAuthStore((s) => s.setActiveMode);
  const activeMode = useAuthStore((s) => s.activeMode);
  const resetRide = useRideStore((s) => s.resetRide);
  // The floating bottom tab bar is position:absolute, so it overlays the end
  // of this ScrollView. Without this extra bottom padding the "Sign out" row
  // sat underneath it and could never be reached.
  const tabBarSpace = useTabBarSpace();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [app, setApp] = useState<DriverApplication | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Server-truth online flag (fetched with the application) so switching
  // back to Rider can take an online driver offline first.
  const [isDriverOnline, setIsDriverOnline] = useState(false);

  const loadApp = useCallback(async () => {
    try {
      setApp(await driversApi.application());
    } catch {
      setApp(null);
    }
    try {
      const p = await driversApi.getMyProfile();
      setIsDriverOnline(!!p?.isOnline);
    } catch {
      // No driver profile / offline — keep last known value.
    }
  }, []);

  useEffect(() => {
    // Async boundary: loadApp() may set state before its first await, which
    // trips react-hooks/set-state-in-effect — a microtask deferral keeps the
    // initial-fetch timing visually identical (useFocusEffect below re-runs
    // this on every focus anyway).
    Promise.resolve().then(loadApp);
  }, [loadApp]);
  useFocusEffect(
    useCallback(() => {
      loadApp();
    }, [loadApp]),
  );

  // Driver card state comes from the persisted user (server truth at login /
  // foreground refresh), so an offline application() fetch can never show a
  // pending/approved user the "Become a driver" card. The application fetch
  // is only used for the rejection reason and submitted date.
  const status = user?.driverStatus ?? 'none';

  const pickAvatar = async () => {
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = await import('expo-image-picker');
    } catch {
      Alert.alert(
        'Image upload unavailable',
        'This preview build (Expo Go) has no image-picker native module. Use a development build for profile photos.',
      );
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const uri = res.assets[0].uri;
    const fileName = uri.split('/').pop() || 'avatar.jpg';
    const lower = fileName.toLowerCase();
    const type = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
    setIsSaving(true);
    try {
      const updated = await authApi.uploadAvatar({ uri, name: fileName, type });
      updateUser(updated);
    } catch (err) {
      Alert.alert('Upload failed', getApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(undefined);
    try {
      const updated = await authApi.updateMe({ name: name.trim() });
      updateUser(updated);
      setIsEditing(false);
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    // Best-effort: an approved driver must not stay "available" after
    // logout. Send the PATCH while the token is still in memory and never
    // await it — serialising getMyProfile + setStatus ahead of local
    // logout made every account wait out up to two 15s-timeout HTTP
    // round-trips (riders paid for a driver-profile probe they can't even
    // have), and a timed-out probe skipped setStatus anyway. Only an
    // approved driver can be online; every other role skips the call.
    if (user?.driverStatus === 'approved') {
      driversApi.setStatus(false).catch(() => {});
    }
    resetRide();
    logout();
  };

  const confirmLogout = () => {
    Alert.alert('Log out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: handleLogout },
    ]);
  };

  // Active trip blocks any mode switch (both directions) — the trip has to
  // be completed or cancelled first.
  const tripInProgress = () => {
    const current = useRideStore.getState().activeRide;
    if (current && ['matched', 'driver_en_route', 'in_progress'].includes(current.status)) {
      Alert.alert(
        'Trip in progress',
        'You cannot switch modes while a trip is active. Complete or cancel it first.',
      );
      return true;
    }
    return false;
  };

  // Rider mode → Driver mode (this same screen is the Profile tab in both
  // modes). Mirrors DriverDashboardScreen: the tabs swap as soon as
  // activeMode flips.
  const switchToDriver = () => {
    if (tripInProgress()) return;
    setActiveMode('driver');
    resetRide();
    disconnectSocket();
    const token = tokenManager.getAccessToken();
    if (token) connectSocket(token, 'driver');
    // No explicit navigation: MainTabNavigator mounts the driver tree
    // (initial route DashboardTab) as soon as activeMode flips.
  };

  // Driver mode → Rider mode (this same screen is the Profile tab in both
  // modes). Mirrors DriverDashboardScreen.switchToRider: go offline first
  // so no "ghost" online driver is left server-side; block on failure.
  const switchToRider = async () => {
    if (tripInProgress()) return;
    if (isDriverOnline) {
      try {
        await driversApi.setStatus(false);
      } catch (err) {
        Alert.alert('Unable to go offline', getApiError(err));
        return;
      }
    }
    setActiveMode('rider');
    resetRide();
    disconnectSocket();
    const token = tokenManager.getAccessToken();
    if (token) connectSocket(token, 'rider');
    // MainTabNavigator swaps to the rider tree (initial route HomeTab).
  };

  const isDriverLayout = activeMode === 'driver';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadApp(); setRefreshing(false); }} />}
    >
      <Text style={styles.title}>Profile</Text>

      {isDriverLayout ? (
        <Card style={styles.driverHeader}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
            {/* Avatar resolves API-relative paths and https (Cloudinary) URLs. */}
            <Avatar name={user?.name ?? '?'} uri={user?.avatar} size={88} />
            <View style={styles.cameraBadge}>
              <Camera size={12} color={colors.card} />
            </View>
          </TouchableOpacity>
          <View style={styles.driverNameRow}>
            <Text style={styles.driverName}>{user?.name}</Text>
            <TouchableOpacity
              style={styles.editCircleSmall}
              onPress={() => {
                setName(user?.name ?? '');
                setIsEditing(true);
              }}
              accessibilityRole="button"
            >
              <Edit2 size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.driverRole}>Vazhi driver</Text>
        </Card>
      ) : (
        <Card style={styles.profileCard}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
            <Avatar name={user?.name ?? '?'} uri={user?.avatar} size={64} />
            <View style={styles.cameraBadge}>
              <Camera size={12} color={colors.card} />
            </View>
          </TouchableOpacity>
          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.profileName}>{user?.name}</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Customer</Text>
              </View>
            </View>
            <Text style={styles.profilePhone}>{user?.phone || ''}</Text>
            {user?.email ? <Text style={styles.profileEmail}>{user.email}</Text> : null}
          </View>
          <TouchableOpacity
            style={styles.editCircle}
            onPress={() => {
              setName(user?.name ?? '');
              setIsEditing(true);
            }}
            accessibilityRole="button"
          >
            <Edit2 size={16} color={colors.primary} />
          </TouchableOpacity>
        </Card>
      )}

      {/* Inline name edit (was an "Edit name" button in the old layout) —
          rider mode opens it via the pencil in the header card, driver mode
          via the pencil next to the name. */}
      {isEditing && (
        <Card style={styles.card}>
          <Input label="Full name" value={name} onChangeText={setName} error={error} autoFocus />
          <View style={styles.editRow}>
            <Button title="Cancel" variant="outline" onPress={() => { setIsEditing(false); setName(user?.name ?? ''); }} style={styles.editBtn} />
            <Button title="Save" onPress={handleSave} loading={isSaving} disabled={isSaving || name.trim().length < 2} style={styles.editBtn} />
          </View>
        </Card>
      )}

      {isDriverLayout ? (
        <>
          <Text style={styles.sectionLabel}>PREFERENCES</Text>
          <Card style={styles.card}>
            <MenuRow
              icon={<Megaphone size={20} color={colors.primary} />}
              title="Ride Announcements"
              subtitle="Voice alerts, language and volume"
              onPress={() => navigation.navigate('RideAnnouncementsSettings')}
            />
            <MenuRow
              icon={<Car size={20} color={colors.primary} />}
              title="My Vehicle"
              subtitle="Your car and documents"
              onPress={() => navigation.navigate('MyVehicle')}
            />
            <MenuRow
              icon={<QrCode size={20} color={colors.primary} />}
              title="Payment & QR"
              subtitle="Add or update your UPI id / pay link"
              onPress={() => navigation.navigate('PaymentQr')}
            />
            <MenuRow
              icon={<HelpCircle size={20} color={colors.primary} />}
              title="Help & support"
              subtitle="Chat with the Vazhi team"
              onPress={() => navigation.navigate('HelpSupport')}
              last
            />
          </Card>

          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <Card style={styles.card}>
            <MenuRow
              icon={<ArrowLeftRight size={20} color={colors.primary} />}
              title="Switch to Customer"
              subtitle="Book rides instead of driving"
              onPress={switchToRider}
            />
            <MenuRow
              icon={<LogOut size={20} color={colors.danger} />}
              title="Sign out"
              danger
              onPress={confirmLogout}
              last
            />
          </Card>
        </>
      ) : (
        <>
          <Card style={styles.card}>
            <MenuRow
              plain
              icon={<Car size={20} color={colors.primary} />}
              title="Rides"
              onPress={() => navigation.navigate('TripsTab')}
            />
            <MenuRow
              plain
              icon={<SlidersHorizontal size={20} color={colors.primary} />}
              title="Ride preferences"
              onPress={() => navigation.navigate('RideAnnouncementsSettings')}
            />
            <MenuRow
              plain
              icon={<HelpCircle size={20} color={colors.primary} />}
              title="Help & support"
              onPress={() => navigation.navigate('HelpSupport')}
              last
            />
          </Card>

          {status === 'pending' && (
            <Card style={styles.card}>
              <View style={styles.cardTitleRow}>
                <BadgeCheck size={18} color={colors.warning} />
                <Text style={styles.cardTitle}>Application under review</Text>
              </View>
              <Text style={styles.metaLine}>
                Submitted{app?.submittedAt ? ` on ${new Date(app.submittedAt).toLocaleDateString()}` : ''}. We will notify you once reviewed.
              </Text>
            </Card>
          )}

          {status === 'rejected' && (
            <Card style={styles.card}>
              <View style={styles.cardTitleRow}>
                <AlertCircle size={18} color={colors.danger} />
                <Text style={styles.cardTitle}>Application needs attention</Text>
              </View>
              <Text style={styles.metaLine}>{app?.rejectionReason ?? 'Your application was not approved.'}</Text>
              <Button title="Re-apply" onPress={() => navigation.navigate('BecomeDriver')} style={styles.editTrigger} />
            </Card>
          )}

          {status === 'suspended' && (
            <Card style={styles.card}>
              <View style={styles.cardTitleRow}>
                <PauseCircle size={18} color={colors.danger} />
                <Text style={styles.cardTitle}>Driver access suspended</Text>
              </View>
              <Text style={styles.metaLine}>Contact support to appeal.</Text>
            </Card>
          )}

          <Card style={styles.card}>
            {status === 'none' && (
              <MenuRow
                plain
                icon={<Car size={20} color={colors.primary} />}
                title="Become a driver"
                subtitle="Earn with Vazhi — upload your car, licence & RC"
                onPress={() => navigation.navigate('BecomeDriver')}
              />
            )}
            {status === 'approved' && (
              <MenuRow
                plain
                icon={<ArrowLeftRight size={20} color={colors.primary} />}
                title="Switch to Driver"
                subtitle="You're a verified driver — drive and earn"
                onPress={switchToDriver}
              />
            )}
            <MenuRow
              plain
              icon={<LogOut size={20} color={colors.danger} />}
              title="Sign out"
              danger
              onPress={confirmLogout}
              last
            />
          </Card>
        </>
      )}

      <Text style={styles.footerText}>Vazhi · v{appVersion}</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  title: { ...typography.heading, fontSize: 28, marginBottom: 16 },
  card: { marginBottom: 16 },
  // Rider header card: avatar left, name + Customer badge, phone/email.
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  profileInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  profileName: { ...typography.cardTitle, fontSize: 18, color: colors.textPrimary },
  badge: { backgroundColor: colors.accentLight, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { ...typography.meta, fontSize: 11, fontWeight: '700', color: colors.primary },
  profilePhone: { ...typography.meta, fontSize: 13, color: colors.textSecondary },
  profileEmail: { ...typography.meta, fontSize: 12, color: colors.textMuted },
  editCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.card,
  },
  // Driver header card: centered avatar + name + role line.
  driverHeader: { alignItems: 'center', paddingVertical: 20, marginBottom: 16 },
  driverNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  driverName: { ...typography.heading, fontSize: 22 },
  driverRole: { ...typography.meta, color: colors.textMuted, marginTop: 2 },
  editCircleSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    ...typography.meta,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 8,
    marginLeft: 4,
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  menuRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  menuIconPlain: { width: 26, alignItems: 'center' },
  menuIconTile: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTexts: { flex: 1, gap: 2 },
  menuTitle: { ...typography.bodyBold, fontSize: 15, color: colors.textPrimary },
  menuDanger: { color: colors.danger },
  menuSub: { ...typography.meta, fontSize: 12, color: colors.textMuted },
  editRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  editBtn: { flex: 1 },
  editTrigger: { marginTop: 12 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { ...typography.cardTitle, fontSize: 16, flex: 1 },
  metaLine: { ...typography.meta, marginTop: 4 },
  footerText: { ...typography.meta, fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
});
