import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, RefreshControl } from 'react-native';
import { LogOut, Mail, Phone, Edit2, Car, BadgeCheck, Camera, AlertCircle, PauseCircle } from 'lucide-react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { colors, typography } from '../../theme/theme';
import { useAuthStore } from '../../store/authStore';
import { useRideStore } from '../../store/rideStore';
import { authApi } from '../../api/auth';
import { driversApi, DriverApplication } from '../../api/drivers';
import { getApiError } from '../../api/client';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { connectSocket, disconnectSocket } from '../../lib/socket';
import { tokenManager } from '../../lib/tokenManager';

// Single Profile for everyone (Profile tab in BOTH rider and driver
// mode). The "Driver" section reflects server driverStatus: none →
// Become a driver; pending → under review (no driver buttons); rejected →
// reason + re-apply; approved → switch mode (Rider ⇄ Driver); suspended →
// contact support.
export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateUser = useAuthStore((s) => s.updateUser);
  const setActiveMode = useAuthStore((s) => s.setActiveMode);
  const activeMode = useAuthStore((s) => s.activeMode);
  const resetRide = useRideStore((s) => s.resetRide);

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
  // pending/approved user the "Become a driver" card. The application record
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
    const name = uri.split('/').pop() || 'avatar.jpg';
    const lower = name.toLowerCase();
    const type = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
    setIsSaving(true);
    try {
      const updated = await authApi.uploadAvatar({ uri, name, type });
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

  const handleLogout = async () => {
    // Best-effort: an online driver must not stay "available" after logout
    // (kept from the removed DriverAccountScreen).
    try {
      await driversApi.getMyProfile();
      await driversApi.setStatus(false).catch(() => {});
    } catch {
      // No driver profile or already offline — proceed to logout.
    }
    resetRide();
    logout();
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadApp(); setRefreshing(false); }} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
          {/* Avatar resolves API-relative paths and https (Cloudinary) URLs. */}
          <Avatar name={user?.name ?? '?'} uri={user?.avatar} size={84} />
          <View style={styles.cameraBadge}>
            <Camera size={14} color="#fff" />
          </View>
        </TouchableOpacity>
        {!isEditing && <Text style={styles.name}>{user?.name}</Text>}
        <Text style={styles.roleLine}>{user?.phone || ''}</Text>
      </View>

      <Card style={styles.card}>
        {isEditing ? (
          <>
            <Input label="Full name" value={name} onChangeText={setName} error={error} autoFocus />
            <View style={styles.editRow}>
              <Button title="Cancel" variant="outline" onPress={() => { setIsEditing(false); setName(user?.name ?? ''); }} style={styles.editBtn} />
              <Button title="Save" onPress={handleSave} loading={isSaving} disabled={isSaving || name.trim().length < 2} style={styles.editBtn} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.row}>
              <Phone size={18} color={colors.textMuted} />
              <Text style={styles.rowText}>{user?.phone || 'No phone on file'}</Text>
            </View>
            {user?.email && (
              <View style={styles.row}>
                <Mail size={18} color={colors.textMuted} />
                <Text style={styles.rowText}>{user.email}</Text>
              </View>
            )}
            <Button
              title="Edit name"
              variant="outline"
              onPress={() => setIsEditing(true)}
              leftIcon={<Edit2 size={16} color={colors.primary} />}
              style={styles.editTrigger}
            />
          </>
        )}
      </Card>

      {status === 'none' && (
        <Card style={styles.driverCta}>
          <View style={styles.driverCtaRow}>
            <View style={styles.driverIcon}>
              <Car size={24} color={colors.primary} />
            </View>
            <View style={styles.driverCtaText}>
              <Text style={styles.driverCtaTitle}>Earn with Vazhi — Become a driver</Text>
              <Text style={styles.driverCtaSub}>Upload your car photo, licence & RC. Our team reviews every application.</Text>
            </View>
          </View>
          <Button title="Become a driver" onPress={() => navigation.navigate('BecomeDriver')} style={styles.ctaBtn} />
        </Card>
      )}

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

      {status === 'approved' && (
        <Card style={styles.card}>
          <View style={styles.cardTitleRow}>
            <BadgeCheck size={18} color={colors.success} />
            <Text style={styles.cardTitle}>Driver verified</Text>
          </View>
          {/* Same screen is Profile in both modes — the button must flip:
              in rider mode offer the switch TO driver, in driver mode the
              switch BACK to rider (was stuck showing "Switch to Driver
              mode" while already in driver mode). */}
          <Button
            title={activeMode === 'driver' ? 'Switch to Rider mode' : 'Switch to Driver mode'}
            onPress={activeMode === 'driver' ? switchToRider : switchToDriver}
            style={styles.editTrigger}
          />
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

      <Button
        title="Log out"
        variant="ghost"
        onPress={() =>
          Alert.alert('Log out?', 'You will need to sign in again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: handleLogout },
          ])
        }
        leftIcon={<LogOut size={18} color={colors.danger} />}
        style={styles.logoutBtn}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 24 },
  cameraBadge: { position: 'absolute', bottom: 0, right: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  name: { ...typography.heading, fontSize: 22, marginTop: 12 },
  roleLine: { ...typography.meta, color: colors.textMuted, marginTop: 2 },
  card: { marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  editTrigger: { marginTop: 12 },
  editRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  editBtn: { flex: 1 },
  driverCta: { marginBottom: 16, backgroundColor: '#EEF2FF', borderColor: 'rgba(33,27,78,0.15)' },
  driverCtaRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  driverIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  driverCtaText: { flex: 1 },
  driverCtaTitle: { ...typography.cardTitle, fontSize: 16 },
  driverCtaSub: { ...typography.meta, fontSize: 12, marginTop: 2 },
  ctaBtn: { marginTop: 4 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { ...typography.cardTitle, fontSize: 16, flex: 1 },
  metaLine: { ...typography.meta, marginTop: 4 },
  logoutBtn: { marginTop: 8 },
});
