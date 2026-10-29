import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import Constants from 'expo-constants';
import { ChevronRight, LogOut, MapPin, Minus, Plus, ShieldCheck, Ticket, Timer } from 'lucide-react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminAccountStackParamList } from '../../navigation/types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';
import { confirmAction } from '../../components/admin/ConfirmDialog';
import { adminApi } from '../../api/admin';
import { useAuthStore } from '../../store/authStore';
import { useAdminStore } from '../../store/adminStore';
import { useRideStore } from '../../store/rideStore';
import { colors, radii, typography } from '../../theme/theme';

type Props = NativeStackScreenProps<AdminAccountStackParamList, 'AdminAccount'>;

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

const RADIUS_PRESETS = [3, 5, 10, 15, 20];

/**
 * Admin-configurable nearby-driver radius. Riders only see drivers inside it
 * and ride offers go only to drivers inside it, nearest first.
 */
function DriverRadiusCard() {
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState(10);
  const [bounds, setBounds] = useState({ min: 1, max: 50 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Used by the Retry button (state resets happen in an event handler).
  const retry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await adminApi.getSettings();
      setSaved(s.driverSearchRadiusKm);
      setDraft(s.driverSearchRadiusKm);
      setBounds({ min: s.minKm, max: s.maxKm });
    } catch {
      setError('Could not load the current radius.');
    } finally {
      setLoading(false);
    }
  }, []);

  // First load: state is only set after the request resolves.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setSaved(s.driverSearchRadiusKm);
        setDraft(s.driverSearchRadiusKm);
        setBounds({ min: s.minKm, max: s.maxKm });
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the current radius.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clamp = (n: number) => Math.min(bounds.max, Math.max(bounds.min, Math.round(n * 10) / 10));
  const dirty = saved !== null && draft !== saved;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const s = await adminApi.updateDriverRadius(draft);
      setSaved(s.driverSearchRadiusKm);
      setDraft(s.driverSearchRadiusKm);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setError((Array.isArray(msg) ? msg[0] : msg) || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.navRow}>
        <View style={styles.navIcon}>
          <MapPin size={18} color={colors.accent} />
        </View>
        <View style={styles.navText}>
          <Text style={styles.navTitle}>Driver search radius</Text>
          <Text style={styles.navSub}>
            Riders see, and are matched with, drivers within this distance
          </Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.radiusLoading} color={colors.accent} />
      ) : (
        <>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setDraft((d) => clamp(d - 1))}
              disabled={draft <= bounds.min}
              accessibilityRole="button"
              accessibilityLabel="Decrease radius"
            >
              <Minus size={18} color={draft <= bounds.min ? colors.textMuted : colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.radiusValue}>{draft} km</Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setDraft((d) => clamp(d + 1))}
              disabled={draft >= bounds.max}
              accessibilityRole="button"
              accessibilityLabel="Increase radius"
            >
              <Plus size={18} color={draft >= bounds.max ? colors.textMuted : colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.chipRow}>
            {RADIUS_PRESETS.map((km) => (
              <TouchableOpacity
                key={km}
                onPress={() => setDraft(km)}
                style={[styles.chip, draft === km && styles.chipActive]}
                accessibilityRole="button"
                accessibilityLabel={`${km} kilometres`}
              >
                <Text style={[styles.chipText, draft === km && styles.chipTextActive]}>{km} km</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.navSub}>
            Allowed {bounds.min}–{bounds.max} km. Offers go to the nearest driver first, then the next.
          </Text>
          {error ? <Text style={styles.radiusError}>{error}</Text> : null}
          <Button
            title={dirty ? 'Save radius' : 'Saved'}
            disabled={!dirty || saving}
            loading={saving}
            style={styles.radiusSave}
            onPress={save}
          />
        </>
      )}
      {!loading && saved === null ? (
        <Button title="Retry" variant="outline" style={styles.radiusSave} onPress={retry} />
      ) : null}
    </Card>
  );
}

const OFFER_TIMEOUT_PRESETS = [10, 15, 20, 30, 45, 60];
const OFFER_TIMEOUT_STEP = 5;

/**
 * Admin-configurable offer timeout: how long each driver has to answer a ride
 * offer before it moves to the next nearest driver. Applies to the next offer
 * made; offers already out keep the deadline they were sent with.
 */
function OfferTimeoutCard() {
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState(15);
  const [bounds, setBounds] = useState({ min: 10, max: 60 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Used by the Retry button (state resets happen in an event handler).
  const retry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await adminApi.getSettings();
      setSaved(s.offerTimeoutSeconds);
      setDraft(s.offerTimeoutSeconds);
      setBounds({ min: s.minOfferTimeoutSeconds, max: s.maxOfferTimeoutSeconds });
    } catch {
      setError('Could not load the current offer time.');
    } finally {
      setLoading(false);
    }
  }, []);

  // First load: state is only set after the request resolves.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setSaved(s.offerTimeoutSeconds);
        setDraft(s.offerTimeoutSeconds);
        setBounds({ min: s.minOfferTimeoutSeconds, max: s.maxOfferTimeoutSeconds });
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the current offer time.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clamp = (n: number) => Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
  const dirty = saved !== null && draft !== saved;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const s = await adminApi.updateOfferTimeout(draft);
      setSaved(s.offerTimeoutSeconds);
      setDraft(s.offerTimeoutSeconds);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setError((Array.isArray(msg) ? msg[0] : msg) || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.navRow}>
        <View style={styles.navIcon}>
          <Timer size={18} color={colors.accent} />
        </View>
        <View style={styles.navText}>
          <Text style={styles.navTitle}>Offer time</Text>
          <Text style={styles.navSub}>How long each driver has to accept a ride before the next driver is asked</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.radiusLoading} color={colors.accent} />
      ) : (
        <>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setDraft((d) => clamp(d - OFFER_TIMEOUT_STEP))}
              disabled={draft <= bounds.min}
              accessibilityRole="button"
              accessibilityLabel="Decrease offer time"
            >
              <Minus size={18} color={draft <= bounds.min ? colors.textMuted : colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.radiusValue}>{draft} s</Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setDraft((d) => clamp(d + OFFER_TIMEOUT_STEP))}
              disabled={draft >= bounds.max}
              accessibilityRole="button"
              accessibilityLabel="Increase offer time"
            >
              <Plus size={18} color={draft >= bounds.max ? colors.textMuted : colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.chipRow}>
            {OFFER_TIMEOUT_PRESETS.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => setDraft(s)}
                style={[styles.chip, draft === s && styles.chipActive]}
                accessibilityRole="button"
                accessibilityLabel={`${s} seconds`}
              >
                <Text style={[styles.chipText, draft === s && styles.chipTextActive]}>{s} s</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.navSub}>
            Allowed {bounds.min}–{bounds.max} seconds. Applies to the next offer made; offers already sent keep their time.
          </Text>
          {error ? <Text style={styles.radiusError}>{error}</Text> : null}
          <Button
            title={dirty ? 'Save offer time' : 'Saved'}
            disabled={!dirty || saving}
            loading={saving}
            style={styles.radiusSave}
            onPress={save}
          />
        </>
      )}
      {!loading && saved === null ? (
        <Button title="Retry" variant="outline" style={styles.radiusSave} onPress={retry} />
      ) : null}
    </Card>
  );
}

/**
 * Admin "Account" tab (spec §3.2): identity card, app/build info and sign-out
 * (with a native confirm, mirroring the rider/driver profile screens).
 */
export const AdminAccountScreen: React.FC<Props> = ({ navigation }) => {
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
          {/* PR-1 (Task 8): entry point to the promo-code manager. */}
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => navigation.navigate('AdminPromos')}
            accessibilityRole="button"
            accessibilityLabel="Promo codes"
          >
            <View style={styles.navIcon}>
              <Ticket size={18} color={colors.accent} />
            </View>
            <View style={styles.navText}>
              <Text style={styles.navTitle}>Promo codes</Text>
              <Text style={styles.navSub}>Create and manage rider discounts</Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </Card>

        <DriverRadiusCard />
        <OfferTimeoutCard />

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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: {
    flex: 1,
  },
  navTitle: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  navSub: {
    ...typography.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  radiusLoading: {
    marginVertical: 20,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 16,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusValue: {
    ...typography.cardTitle,
    fontSize: 28,
    minWidth: 110,
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 14,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  radiusError: {
    ...typography.meta,
    color: colors.danger,
    marginTop: 8,
  },
  radiusSave: {
    marginTop: 12,
  },
  footnote: {
    ...typography.meta,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
});
