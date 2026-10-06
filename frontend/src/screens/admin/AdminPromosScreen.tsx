import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, Switch, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pencil, Plus, Tag, Trash2, X } from 'lucide-react-native';
import { AdminAccountStackParamList } from '../../navigation/types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { EmptyState } from '../../components/admin/EmptyState';
import { ErrorState } from '../../components/admin/ErrorState';
import { SkeletonList } from '../../components/admin/SkeletonList';
import { confirmAction } from '../../components/admin/ConfirmDialog';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Input } from '../../components/primitives/Input';
import { Pill } from '../../components/primitives/Pill';
import { adminApi, AdminPromo, AdminPromoInput } from '../../api/admin';
import { getApiError } from '../../api/client';
import { colors, radii, typography } from '../../theme/theme';

type Props = NativeStackScreenProps<AdminAccountStackParamList, 'AdminPromos'>;

/** Form state — strings keep TextInput happy; parsed on submit. */
interface FormState {
  id: string | null; // null = create
  code: string;
  discountAmount: string;
  title: string;
  subtitle: string;
  firstRideOnly: boolean;
  active: boolean;
  validFrom: string;
  validTo: string;
  maxRedemptions: string;
}

const emptyForm = (): FormState => ({
  id: null,
  code: '',
  discountAmount: '',
  title: '',
  subtitle: '',
  firstRideOnly: false,
  active: true,
  validFrom: '',
  validTo: '',
  maxRedemptions: '',
});

const formFromPromo = (p: AdminPromo): FormState => ({
  id: p.id,
  code: p.code,
  discountAmount: String(p.discountAmount),
  title: p.title ?? '',
  subtitle: p.subtitle ?? '',
  firstRideOnly: p.firstRideOnly,
  active: p.active,
  validFrom: p.validFrom ? p.validFrom.slice(0, 10) : '',
  validTo: p.validTo ? p.validTo.slice(0, 10) : '',
  maxRedemptions: p.maxRedemptions != null ? String(p.maxRedemptions) : '',
});

type ParseResult = { ok: true; value: Date | null } | { ok: false };

/**
 * Date-only inputs are read as whole days in local time: "valid from" starts
 * at 00:00 of that day, "valid until" ends at 23:59:59 of it (inclusive end).
 * Empty input clears the bound (null).
 */
const parseDay = (raw: string, endOfDay: boolean): ParseResult => {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return {
      ok: true,
      value: new Date(endOfDay ? `${text}T23:59:59.999` : `${text}T00:00:00.000`),
    };
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? { ok: false } : { ok: true, value: parsed };
};

const statusOf = (p: AdminPromo, now = new Date()): { label: string; variant: 'primary' | 'success' | 'danger' | 'warning' | 'muted' } => {
  if (!p.active) return { label: 'Inactive', variant: 'muted' };
  if (p.validFrom && now < new Date(p.validFrom)) return { label: 'Scheduled', variant: 'primary' };
  if (p.validTo && now > new Date(p.validTo)) return { label: 'Expired', variant: 'danger' };
  if (p.maxRedemptions != null && p.redemptionCount >= p.maxRedemptions) {
    return { label: 'Limit reached', variant: 'warning' };
  }
  return { label: 'Active', variant: 'success' };
};

const fmtDay = (iso: string | null): string | null =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

const windowText = (p: AdminPromo): string => {
  const from = fmtDay(p.validFrom);
  const to = fmtDay(p.validTo);
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return 'Always valid';
};

const redemptionsText = (p: AdminPromo): string =>
  p.maxRedemptions != null
    ? `${p.redemptionCount} / ${p.maxRedemptions} redemptions`
    : `${p.redemptionCount} redemption${p.redemptionCount === 1 ? '' : 's'}`;

/**
 * PR-1 (Task 8): admin promo manager — list every code with its live status,
 * create/edit via a modal form (validity window, cap, first-ride-only),
 * activate/deactivate in one tap and delete with a confirm. Pushed from the
 * Account tab (Account → Promo codes).
 */
export const AdminPromosScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Promise callbacks only (A-9 pattern): direct setState inside an effect
  // body trips react-hooks/set-state-in-effect, so the chain stays inline.
  const load = useCallback(
    () =>
      adminApi
        .listPromos()
        .then((rows) => {
          if (mounted.current) {
            setPromos(rows);
            setListError(null);
          }
        })
        .catch((err) => {
          if (mounted.current) setListError(getApiError(err));
        })
        .finally(() => {
          if (mounted.current) setLoading(false);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    if (mounted.current) setRefreshing(false);
  }, [load]);

  const openCreate = () => {
    setFormError(null);
    setForm(emptyForm());
  };

  const openEdit = (p: AdminPromo) => {
    setFormError(null);
    setForm(formFromPromo(p));
  };

  const submit = async () => {
    if (!form) return;
    const code = form.code.trim().toUpperCase();
    if (code.length < 3 || code.length > 30) {
      setFormError('Code must be 3–30 characters.');
      return;
    }
    const amount = Number(form.discountAmount);
    if (!Number.isInteger(amount) || amount < 0) {
      setFormError('Discount must be a whole rupee amount.');
      return;
    }
    const from = parseDay(form.validFrom, false);
    const to = parseDay(form.validTo, true);
    if (!from.ok) {
      setFormError(`Invalid "valid from" date — use YYYY-MM-DD.`);
      return;
    }
    if (!to.ok) {
      setFormError(`Invalid "valid until" date — use YYYY-MM-DD.`);
      return;
    }
    if (from.value && to.value && from.value.getTime() >= to.value.getTime()) {
      setFormError('"Valid from" must be before "Valid until".');
      return;
    }
    let max: number | null = null;
    if (form.maxRedemptions.trim()) {
      max = Number(form.maxRedemptions.trim());
      if (!Number.isInteger(max) || max < 1) {
        setFormError('Redemption cap must be a whole number of at least 1.');
        return;
      }
    }
    const input: AdminPromoInput = {
      code,
      discountAmount: amount,
      title: form.title.trim() || null,
      subtitle: form.subtitle.trim() || null,
      firstRideOnly: form.firstRideOnly,
      active: form.active,
      validFrom: from.value ? from.value.toISOString() : null,
      validTo: to.value ? to.value.toISOString() : null,
      maxRedemptions: max,
    };
    setSaving(true);
    try {
      if (form.id) await adminApi.updatePromo(form.id, input);
      else await adminApi.createPromo(input);
      if (!mounted.current) return;
      setForm(null);
      setFormError(null);
      await load();
    } catch (err) {
      if (mounted.current) setFormError(getApiError(err));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const toggleActive = async (p: AdminPromo) => {
    try {
      await adminApi.updatePromo(p.id, {
        code: p.code,
        discountAmount: p.discountAmount,
        title: p.title,
        subtitle: p.subtitle,
        cta: p.cta,
        firstRideOnly: p.firstRideOnly,
        active: !p.active,
        validFrom: p.validFrom,
        validTo: p.validTo,
        maxRedemptions: p.maxRedemptions,
      });
      await load();
    } catch (err) {
      if (mounted.current) setListError(getApiError(err));
    }
  };

  const remove = async (p: AdminPromo) => {
    const ok = await confirmAction(
      `Delete ${p.code}?`,
      'The code stops working immediately. Redemption history is kept.',
      'Delete',
    );
    if (!ok) return;
    try {
      await adminApi.deletePromo(p.id);
      await load();
    } catch (err) {
      if (mounted.current) setListError(getApiError(err));
    }
  };

  const renderBody = () => {
    if (loading) return <SkeletonList count={4} style={styles.list} />;
    if (listError) return <ErrorState message={listError} onRetry={() => void load()} />;
    if (promos.length === 0) {
      return (
        <EmptyState
          title="No promo codes yet"
          message="Create a code so riders can apply it at booking."
          icon={<Tag size={30} color={colors.textMuted} />}
          action={<Button title="New promo code" onPress={openCreate} fullWidth />}
        />
      );
    }
    return (
      <View style={styles.list}>
        {promos.map((p) => {
          const status = statusOf(p);
          return (
            <Card key={p.id} style={styles.promoCard}>
              <View style={styles.promoTop}>
                <View style={styles.promoCodeCol}>
                  <Text style={styles.promoCode}>{p.code}</Text>
                  <Text style={styles.promoAmount}>Rs {p.discountAmount} off</Text>
                </View>
                <Pill label={status.label} variant={status.variant} />
              </View>
              {p.title ? (
                <Text style={styles.promoTitle} numberOfLines={1}>
                  {p.title}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>{windowText(p)}</Text>
                <Text style={styles.metaText}>•</Text>
                <Text style={styles.metaText}>{redemptionsText(p)}</Text>
                {p.firstRideOnly ? (
                  <Pill label="First ride only" variant="outline" style={styles.firstRidePill} />
                ) : null}
              </View>
              <View style={styles.actions}>
                <Button
                  title="Edit"
                  variant="outline"
                  size="small"
                  leftIcon={<Pencil size={15} color={colors.primary} />}
                  onPress={() => openEdit(p)}
                />
                <Button
                  title={p.active ? 'Deactivate' : 'Activate'}
                  variant={p.active ? 'outline' : 'success'}
                  size="small"
                  onPress={() => void toggleActive(p)}
                />
                <Button
                  title="Delete"
                  variant="danger"
                  size="small"
                  leftIcon={<Trash2 size={15} color={colors.danger} />}
                  onPress={() => void remove(p)}
                />
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <AdminHeader
        variant="plain"
        title="Promo codes"
        subtitle="Discounts riders can apply at booking"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      >
        {promos.length > 0 && !listError ? (
          <Button
            title="New promo code"
            leftIcon={<Plus size={18} color={colors.textLight} />}
            onPress={openCreate}
            style={styles.createBtn}
          />
        ) : null}
        {renderBody()}
      </ScrollView>

      <Modal
        visible={form !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setForm(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{form?.id ? 'Edit promo' : 'New promo'}</Text>
              <Button
                title=""
                variant="ghost"
                size="small"
                leftIcon={<X size={20} color={colors.textSecondary} />}
                onPress={() => setForm(null)}
              />
            </View>
            {form ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Input
                  label="Code"
                  value={form.code}
                  onChangeText={(t) => setForm({ ...form, code: t.toUpperCase() })}
                  placeholder="e.g. FESTIVE50"
                  maxLength={30}
                />
                <Input
                  label="Discount (Rs)"
                  value={form.discountAmount}
                  onChangeText={(t) => setForm({ ...form, discountAmount: t })}
                  placeholder="e.g. 20"
                  keyboardType="numeric"
                />
                <Input
                  label="Card title (optional)"
                  value={form.title}
                  onChangeText={(t) => setForm({ ...form, title: t })}
                  placeholder="Rs 20 off your first ride"
                  maxLength={140}
                />
                <Input
                  label="Card subtitle (optional)"
                  value={form.subtitle}
                  onChangeText={(t) => setForm({ ...form, subtitle: t })}
                  placeholder="Tap to apply code VAZHI20"
                  maxLength={200}
                />
                <Input
                  label="Valid from (optional)"
                  value={form.validFrom}
                  onChangeText={(t) => setForm({ ...form, validFrom: t })}
                  placeholder="YYYY-MM-DD"
                  helperText="Empty = no start date"
                />
                <Input
                  label="Valid until (optional)"
                  value={form.validTo}
                  onChangeText={(t) => setForm({ ...form, validTo: t })}
                  placeholder="YYYY-MM-DD"
                  helperText="Empty = no end date; the until-day is included"
                />
                <Input
                  label="Redemption cap (optional)"
                  value={form.maxRedemptions}
                  onChangeText={(t) => setForm({ ...form, maxRedemptions: t })}
                  placeholder="e.g. 100"
                  keyboardType="numeric"
                  helperText="Empty = unlimited"
                />
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchLabel}>Active</Text>
                    <Text style={styles.switchHelp}>Riders can see and apply it</Text>
                  </View>
                  <Switch
                    value={form.active}
                    onValueChange={(v) => setForm({ ...form, active: v })}
                    trackColor={{ true: colors.primary, false: colors.border }}
                    thumbColor={colors.surface}
                  />
                </View>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchLabel}>First ride only</Text>
                    <Text style={styles.switchHelp}>Only riders with no completed rides</Text>
                  </View>
                  <Switch
                    value={form.firstRideOnly}
                    onValueChange={(v) => setForm({ ...form, firstRideOnly: v })}
                    trackColor={{ true: colors.primary, false: colors.border }}
                    thumbColor={colors.surface}
                  />
                </View>
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <View style={styles.modalActions}>
                  <Button title="Cancel" variant="outline" onPress={() => setForm(null)} style={styles.modalBtn} />
                  <Button
                    title={form.id ? 'Save changes' : 'Create promo'}
                    onPress={() => void submit()}
                    loading={saving}
                    disabled={saving}
                    style={styles.modalBtn}
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
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
    paddingBottom: 40,
  },
  createBtn: {
    marginBottom: 14,
  },
  list: {
    paddingTop: 4,
  },
  promoCard: {
    marginBottom: 12,
  },
  promoTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  promoCodeCol: {
    flex: 1,
  },
  promoCode: {
    ...typography.cardTitle,
    fontSize: 17,
  },
  promoAmount: {
    ...typography.metaBold,
    color: colors.accent,
    marginTop: 2,
  },
  promoTitle: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  metaText: {
    ...typography.meta,
    color: colors.textMuted,
  },
  firstRidePill: {
    marginLeft: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 20,
    paddingTop: 16,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    ...typography.heading,
    fontSize: 20,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  switchText: {
    flex: 1,
  },
  switchLabel: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  switchHelp: {
    ...typography.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  formError: {
    ...typography.meta,
    color: colors.danger,
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  modalBtn: {
    flex: 1,
  },
});
