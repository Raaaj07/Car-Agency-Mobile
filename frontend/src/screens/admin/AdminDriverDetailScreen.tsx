import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Star } from 'lucide-react-native';
import { AdminDriversStackParamList, AdminTabParamList } from '../../navigation/types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { ActionBar } from '../../components/admin/ActionBar';
import { DocumentTile } from '../../components/admin/DocumentTile';
import { DocumentViewerModal } from '../../components/admin/DocumentViewerModal';
import { EmptyState } from '../../components/admin/EmptyState';
import { ErrorState } from '../../components/admin/ErrorState';
import { ReasonModal } from '../../components/admin/ReasonModal';
import { RideRow } from '../../components/admin/RideRow';
import { SkeletonList } from '../../components/admin/SkeletonList';
import { StatusPill } from '../../components/admin/StatusPill';
import { confirmAction, confirmDestructive } from '../../components/admin/ConfirmDialog';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { adminApi, AdminFileResponse, DriverDetail } from '../../api/admin';
import { getApiError } from '../../api/client';
import { useAdminStore } from '../../store/adminStore';
import { AUDIT_ACTION_LABEL } from '../../utils/audit';
import { colors, typography } from '../../theme/theme';
import { formatDateTimeIST, inr, timeAgo } from '../../utils/format';

type Props = NativeStackScreenProps<AdminDriversStackParamList, 'AdminDriverDetail'>;
type DocKind = 'licenseImage' | 'rcImage' | 'vehiclePhoto';
type Busy = 'approve' | 'reject' | 'suspend' | 'reinstate' | null;

/** 409 from suspend carries the blocking ride id in the response body (A-3). */
function activeRideIdOf(err: unknown): string | null {
  const response = (err as { response?: { data?: { rideId?: unknown } } } | null)?.response;
  const rideId = response?.data?.rideId;
  return typeof rideId === 'string' ? rideId : null;
}

/**
 * Milliseconds until ~20 s before a signed URL expires (0 when unknown/past).
 * Module-level so `Date.now` never runs during render (react-hooks purity).
 */
function msUntilSignedUrlExpiry(expiresAt: string): number {
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return 0;
  return expiry - Date.now() - 20_000;
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count !== undefined ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
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
 * Driver/application detail (spec §3.2): profile + vehicle cards, document
 * tiles with a signed-URL viewer (auto-refreshed before the ~10 min expiry),
 * live stats + last 10 rides for approved drivers, full audit history, and a
 * status-dependent ActionBar (Approve/Reject, Suspend, Reinstate).
 */
export const AdminDriverDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { driverId } = route.params;

  const [detail, setDetail] = useState<DriverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [modal, setModal] = useState<'reject' | 'suspend' | null>(null);
  const [reason, setReason] = useState('');

  const [doc, setDoc] = useState<{ kind: DocKind; label: string } | null>(null);
  const [docFile, setDocFile] = useState<AdminFileResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline promise chain — calling a setState-bearing function directly from
  // an effect trips react-hooks/set-state-in-effect (A-9).
  useEffect(() => {
    let live = true;
    adminApi
      .driverDetail(driverId)
      .then((d) => {
        if (live) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (live) setError(getApiError(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [driverId]);

  // Refetch after an action (event-handler context — sync setState is fine).
  const reload = async () => {
    try {
      setDetail(await adminApi.driverDetail(driverId));
      setError(null);
    } catch (err) {
      setError(getApiError(err));
    }
  };

  const onRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .driverDetail(driverId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((err) => setError(getApiError(err)))
      .finally(() => setLoading(false));
  }, [driverId]);

  useEffect(() => {
    return () => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, []);

  const clearExpiryTimer = () => {
    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
  };

  const openDoc = async (kind: DocKind, label: string) => {
    setDoc({ kind, label });
    setDocLoading(true);
    setDocError(null);
    setDocFile(null);
    clearExpiryTimer();
    try {
      const file = await adminApi.file(driverId, kind);
      setDocFile(file);
      // Signed URLs live ~10 min — refresh silently just before expiry so an
      // admin reading documents never hits a dead link (spec §3.2).
      if (file.expiresAt) {
        const ms = msUntilSignedUrlExpiry(file.expiresAt);
        if (ms > 0 && ms < 10 * 60_000) {
          expiryTimer.current = setTimeout(() => {
            expiryTimer.current = null;
            void openDoc(kind, label);
          }, ms);
        }
      }
    } catch (err) {
      setDocError(getApiError(err));
    } finally {
      setDocLoading(false);
    }
  };

  const closeDoc = () => {
    clearExpiryTimer();
    setDoc(null);
    setDocFile(null);
    setDocError(null);
  };

  const confirmApprove = async () => {
    const name = detail?.applicantName ?? 'This applicant';
    const ok = await confirmAction(
      'Approve application?',
      `${name} will be able to go online and accept rides.`,
      'Approve',
    );
    if (!ok) return;
    setBusy('approve');
    try {
      await adminApi.approve(driverId);
      await reload();
      useAdminStore.getState().notifyDataChanged();
    } catch (err) {
      Alert.alert('Approve failed', getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const submitReject = async (value: string) => {
    setModal(null);
    setBusy('reject');
    try {
      await adminApi.reject(driverId, value);
      await reload();
      useAdminStore.getState().notifyDataChanged();
    } catch (err) {
      Alert.alert('Reject failed', getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const submitSuspend = async (value: string, force?: boolean): Promise<void> => {
    setModal(null);
    setBusy('suspend');
    try {
      await adminApi.suspend(driverId, value, force);
      await reload();
      useAdminStore.getState().notifyDataChanged();
    } catch (err) {
      const rideId = activeRideIdOf(err);
      if (rideId && !force) {
        // A-3: default 409 carries the blocking ride; force cancels it first.
        const confirmed = await confirmDestructive(
          'Driver has an active ride',
          `Suspending anyway cancels ride ${rideId.slice(0, 8)}… first and notifies the rider. Continue?`,
          'Suspend & cancel ride',
        );
        if (confirmed) {
          await submitSuspend(value, true);
        }
        return;
      }
      Alert.alert('Suspend failed', getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const doReinstate = async () => {
    const name = detail?.applicantName ?? 'This driver';
    const ok = await confirmAction(
      'Reinstate driver?',
      `${name} will be able to go online again.`,
      'Reinstate',
    );
    if (!ok) return;
    setBusy('reinstate');
    try {
      await adminApi.reinstate(driverId);
      await reload();
      useAdminStore.getState().notifyDataChanged();
    } catch (err) {
      Alert.alert('Reinstate failed', getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const tabNav = navigation.getParent<BottomTabNavigationProp<AdminTabParamList>>();
  const openRideDetail = (rideId: string) =>
    tabNav?.navigate('rides', { screen: 'AdminRideDetail', params: { rideId } });

  if (loading || !detail) {
    return (
      <View style={styles.container}>
        <AdminHeader variant="plain" title="Driver detail" onBack={() => navigation.goBack()} />
        <View style={styles.loadingBox}>
          {error ? <ErrorState message={error} onRetry={onRetry} /> : <SkeletonList count={4} />}
        </View>
      </View>
    );
  }

  const showStats = detail.status === 'approved';
  const hasDocs = detail.hasLicenseImage || detail.hasRcImage || detail.hasVehiclePhoto;

  return (
    <View style={styles.container}>
      <AdminHeader
        variant="plain"
        title="Driver detail"
        subtitle={detail.applicantName}
        onBack={() => navigation.goBack()}
        right={<StatusPill kind="application" value={detail.status} />}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <View style={styles.profileRow}>
            <Avatar name={detail.applicantName} uri={detail.avatar ?? undefined} size={64} />
            <View style={styles.profileText}>
              <Text style={styles.name} numberOfLines={1}>
                {detail.applicantName}
              </Text>
              <Text style={styles.phone}>{detail.phone}</Text>
              <View style={styles.pillRow}>
                <Pill label={detail.vehicleType} variant="outline" />
                {showStats ? (
                  <Pill
                    label={detail.stats.isOnline ? 'Online' : 'Offline'}
                    variant={detail.stats.isOnline ? 'success' : 'muted'}
                  />
                ) : null}
              </View>
            </View>
          </View>
          <View style={styles.divider} />
          <DetailRow label="Submitted" value={formatDateTimeIST(detail.submittedAt)} />
          <DetailRow
            label="Reviewed"
            value={detail.reviewedAt ? formatDateTimeIST(detail.reviewedAt) : '—'}
          />
          <DetailRow label="Reviewer" value={detail.reviewerName ?? '—'} />
          {detail.email ? <DetailRow label="Email" value={detail.email} /> : null}
          {detail.status === 'rejected' && detail.rejectionReason ? (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonLabel}>Rejection reason</Text>
              <Text style={styles.reasonText}>{detail.rejectionReason}</Text>
            </View>
          ) : null}
        </Card>

        <SectionTitle title="Vehicle & licence" />
        <Card style={styles.card}>
          <DetailRow label="Type" value={detail.vehicleType} />
          <DetailRow label="Model" value={detail.carModel} />
          <DetailRow label="Plate" value={detail.plateNumber} />
          <DetailRow label="Licence no." value={detail.licenseNumber ?? '—'} />
          <DetailRow label="RC no." value={detail.rcNumber ?? '—'} />
        </Card>

        <SectionTitle title="Documents" />
        {hasDocs ? (
          <View style={styles.docGrid}>
            <DocumentTile
              label="Driving licence"
              state={detail.hasLicenseImage ? 'ready' : 'missing'}
              onPress={detail.hasLicenseImage ? () => void openDoc('licenseImage', 'Driving licence') : undefined}
            />
            <DocumentTile
              label="RC book"
              state={detail.hasRcImage ? 'ready' : 'missing'}
              onPress={detail.hasRcImage ? () => void openDoc('rcImage', 'RC book') : undefined}
            />
            <DocumentTile
              label="Vehicle photo"
              state={detail.hasVehiclePhoto ? 'ready' : 'missing'}
              onPress={detail.hasVehiclePhoto ? () => void openDoc('vehiclePhoto', 'Vehicle photo') : undefined}
            />
          </View>
        ) : (
          <EmptyState title="No documents submitted" message="This application came in without photos." />
        )}

        {showStats ? (
          <>
            <SectionTitle title="Activity" />
            <Card style={styles.card}>
              <View style={styles.statRow}>
                <Star size={16} color={colors.accent} fill={colors.accent} />
                <Text style={styles.statText}>
                  {detail.stats.rating.toFixed(1)} rating · {detail.stats.totalTrips} trips
                </Text>
              </View>
              <DetailRow
                label="Today"
                value={`${inr(detail.stats.todayEarnings)} · ${detail.stats.todayTrips} trips`}
              />
              <DetailRow
                label="Last location"
                value={detail.stats.lastLocationAt ? timeAgo(detail.stats.lastLocationAt) : '—'}
              />
            </Card>

            <SectionTitle title="Recent rides" count={detail.lastRides.length} />
            {detail.lastRides.length === 0 ? (
              <EmptyState title="No rides yet" message="This driver has not completed any rides." />
            ) : (
              detail.lastRides.map((ride) => (
                <RideRow key={ride.id} ride={ride} onPress={() => openRideDetail(ride.id)} />
              ))
            )}
          </>
        ) : null}

        <SectionTitle title="Review history" count={detail.history.length} />
        {detail.history.length === 0 ? (
          <Text style={styles.hint}>No review actions yet.</Text>
        ) : (
          detail.history.map((entry) => (
            <Card key={entry.id} style={styles.historyCard}>
              <View style={styles.historyHead}>
                <Text style={styles.historyAction} numberOfLines={1}>
                  {AUDIT_ACTION_LABEL[entry.action]}
                </Text>
                <Text style={styles.historyTime}>{timeAgo(entry.createdAt)}</Text>
              </View>
              <Text style={styles.historyMeta}>
                {(entry.actorName ?? 'System') + ' · ' + formatDateTimeIST(entry.createdAt)}
              </Text>
              {entry.reason ? <Text style={styles.historyReason}>{entry.reason}</Text> : null}
            </Card>
          ))
        )}
      </ScrollView>

      <ActionBar>
        {detail.status === 'pending' ? (
          <>
            <Button
              title="Reject"
              variant="danger"
              fullWidth={false}
              style={styles.actionBtn}
              disabled={busy !== null}
              onPress={() => {
                setReason('');
                setModal('reject');
              }}
            />
            <Button
              title="Approve"
              variant="primary"
              fullWidth={false}
              style={styles.actionBtn}
              loading={busy === 'approve'}
              disabled={busy !== null && busy !== 'approve'}
              onPress={() => void confirmApprove()}
            />
          </>
        ) : null}
        {detail.status === 'rejected' ? (
          <Button
            title="Approve"
            variant="primary"
            fullWidth={false}
            style={styles.actionBtn}
            loading={busy === 'approve'}
            disabled={busy !== null && busy !== 'approve'}
            onPress={() => void confirmApprove()}
          />
        ) : null}
        {detail.status === 'approved' ? (
          <Button
            title="Suspend"
            variant="danger"
            fullWidth={false}
            style={styles.actionBtn}
            loading={busy === 'suspend'}
            disabled={busy !== null && busy !== 'suspend'}
            onPress={() => {
              setReason('');
              setModal('suspend');
            }}
          />
        ) : null}
        {detail.status === 'suspended' ? (
          <Button
            title="Reinstate"
            variant="success"
            fullWidth={false}
            style={styles.actionBtn}
            loading={busy === 'reinstate'}
            disabled={busy !== null && busy !== 'reinstate'}
            onPress={() => void doReinstate()}
          />
        ) : null}
      </ActionBar>

      <ReasonModal
        visible={modal !== null}
        title={modal === 'suspend' ? 'Suspend driver' : 'Reject application'}
        description={
          modal === 'suspend'
            ? 'Required — written to the audit trail (5–300 characters).'
            : 'Tell the applicant why (5–300 characters, written to the audit trail).'
        }
        value={reason}
        onChange={setReason}
        onSubmit={(value) => {
          if (modal === 'suspend') void submitSuspend(value);
          else void submitReject(value);
        }}
        onClose={() => setModal(null)}
        submitLabel={modal === 'suspend' ? 'Suspend' : 'Reject'}
        destructive
      />

      <DocumentViewerModal
        visible={doc !== null}
        title={doc?.label ?? ''}
        mime={docFile?.mime ?? null}
        url={docFile?.url ?? null}
        base64={docFile?.base64 ?? null}
        loading={docLoading}
        error={docError}
        onClose={closeDoc}
        onRetry={doc ? () => void openDoc(doc.kind, doc.label) : undefined}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingBox: {
    paddingHorizontal: 20,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 32,
  },
  card: {
    marginBottom: 4,
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
  reasonBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  reasonLabel: {
    ...typography.metaBold,
    color: colors.danger,
    marginBottom: 4,
  },
  reasonText: {
    ...typography.meta,
    color: colors.textPrimary,
    lineHeight: 19,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    ...typography.cardTitle,
  },
  sectionCount: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  docGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  statText: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  hint: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  historyCard: {
    marginBottom: 10,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyAction: {
    ...typography.bodyBold,
    flex: 1,
  },
  historyTime: {
    ...typography.meta,
    color: colors.textMuted,
  },
  historyMeta: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: 4,
  },
  historyReason: {
    ...typography.meta,
    color: colors.textPrimary,
    marginTop: 6,
    lineHeight: 19,
  },
  actionBtn: {
    flex: 1,
  },
});
