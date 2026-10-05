import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { AdminRidesStackParamList, AdminTabParamList } from '../../navigation/types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { ActionBar } from '../../components/admin/ActionBar';
import { EmptyState } from '../../components/admin/EmptyState';
import { ErrorState } from '../../components/admin/ErrorState';
import { ReasonModal } from '../../components/admin/ReasonModal';
import { SkeletonList } from '../../components/admin/SkeletonList';
import { StatusPill } from '../../components/admin/StatusPill';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { adminApi, AdminRideDetail, PaymentMethod } from '../../api/admin';
import { getApiError } from '../../api/client';
import { useAdminStore } from '../../store/adminStore';
import { colors, typography } from '../../theme/theme';
import { formatDateTimeIST, inr, maskPhone } from '../../utils/format';

type Props = NativeStackScreenProps<AdminRidesStackParamList, 'AdminRideDetail'>;

type ModalKind = 'cancel' | 'paid' | 'disputed' | null;
type Busy = 'cancel' | 'paid' | 'disputed' | null;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  wallet: 'Wallet',
  card: 'Card',
  cash: 'Cash',
};

/** Who set paymentStatus — payment lifecycle bug (A-5) is traceable here. */
const MARKED_BY_LABEL: Record<string, string> = {
  rider: 'Rider (self-reported)',
  driver: 'Driver confirmed',
  admin: 'Admin resolution',
  provider: 'Razorpay verified',
};

const CANCELLED_BY_LABEL: Record<string, string> = {
  rider: 'the rider',
  driver: 'the driver',
  system: 'the system',
  admin: 'an admin',
};

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function FareRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.fareRow}>
      <Text style={strong ? styles.fareLabelStrong : styles.fareLabel}>{label}</Text>
      <Text style={strong ? styles.fareValueStrong : styles.fareValue}>{value}</Text>
    </View>
  );
}

/**
 * Ride detail (spec §3.2): timeline with IST stamps, full fare breakdown,
 * payment trail (who marked it paid and every payment row), masked rider card
 * + tappable driver card, and the Cancel / Mark paid / Mark disputed actions.
 */
export const AdminRideDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { rideId } = route.params;

  const [detail, setDetail] = useState<AdminRideDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [reason, setReason] = useState('');

  // Inline promise chain — a direct setState call in the effect body trips
  // react-hooks/set-state-in-effect (A-9).
  useEffect(() => {
    let live = true;
    adminApi
      .rideDetail(rideId)
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
  }, [rideId]);

  const reload = async () => {
    try {
      setDetail(await adminApi.rideDetail(rideId));
      setError(null);
    } catch (err) {
      setError(getApiError(err));
    }
  };

  const onRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .rideDetail(rideId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((err) => setError(getApiError(err)))
      .finally(() => setLoading(false));
  }, [rideId]);

  const openModal = (kind: Exclude<ModalKind, null>) => {
    setReason('');
    setModal(kind);
  };

  const submitModal = async (value: string) => {
    const kind = modal;
    setModal(null);
    if (!kind) return;
    setBusy(kind);
    try {
      if (kind === 'cancel') {
        await adminApi.cancelRide(rideId, value);
      } else {
        await adminApi.resolvePayment(rideId, kind, value);
      }
      await reload();
      useAdminStore.getState().notifyDataChanged();
    } catch (err) {
      Alert.alert(
        kind === 'cancel' ? 'Cancel failed' : 'Payment update failed',
        getApiError(err),
      );
    } finally {
      setBusy(null);
    }
  };

  const tabNav = navigation.getParent<BottomTabNavigationProp<AdminTabParamList>>();
  const openDriverDetail = (driverId: string) =>
    tabNav?.navigate('drivers', { screen: 'AdminDriverDetail', params: { driverId } });

  if (loading || !detail) {
    return (
      <View style={styles.container}>
        <AdminHeader variant="plain" title="Ride detail" onBack={() => navigation.goBack()} />
        <View style={styles.loadingBox}>
          {error ? <ErrorState message={error} onRetry={onRetry} /> : <SkeletonList count={4} />}
        </View>
      </View>
    );
  }

  const fare = detail.fareBreakdown;
  const canCancel = detail.status !== 'completed' && detail.status !== 'cancelled';
  const canResolve = detail.status === 'completed' && detail.paymentStatus !== 'paid';
  const markedBy = detail.paymentMarkedBy ? MARKED_BY_LABEL[detail.paymentMarkedBy] : null;

  const timeline: { label: string; at: string | null }[] = [
    { label: 'Requested', at: detail.timeline.createdAt },
    { label: 'Matched with driver', at: detail.timeline.matchedAt },
    { label: 'Trip started', at: detail.timeline.startedAt },
    { label: 'Completed', at: detail.timeline.completedAt },
    { label: 'Cancelled', at: detail.timeline.cancelledAt },
  ];

  return (
    <View style={styles.container}>
      <AdminHeader
        variant="plain"
        title="Ride detail"
        subtitle={formatDateTimeIST(detail.createdAt)}
        onBack={() => navigation.goBack()}
        right={<StatusPill kind="ride" value={detail.status} />}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <View style={styles.pillRow}>
            <StatusPill kind="payment" value={detail.paymentStatus} />
            <Pill label={METHOD_LABEL[detail.paymentMethod]} variant="outline" />
            <Pill label={detail.vehicleType} variant="outline" />
          </View>
          <Text style={styles.route} numberOfLines={2}>
            {detail.pickupAddress || 'Pickup'} → {detail.dropoffAddress || 'Drop-off'}
          </Text>
          <Text style={styles.routeMeta}>
            {detail.driverName ? `${detail.driverName} · ` : ''}
            {detail.fareTotal > 0 ? inr(detail.fareTotal + detail.tipAmount) : '—'}
            {detail.tipAmount > 0 ? ` (+${inr(detail.tipAmount)} tip)` : ''}
          </Text>
        </Card>

        <SectionTitle title="Timeline" />
        <Card style={styles.card}>
          {timeline.map((step) => (
            <View key={step.label} style={styles.timelineRow}>
              <View style={[styles.dot, step.at ? styles.dotOn : styles.dotOff]} />
              <Text style={[styles.timelineLabel, !step.at && styles.timelinePending]}>
                {step.label}
              </Text>
              <Text style={styles.timelineTime}>{formatDateTimeIST(step.at)}</Text>
            </View>
          ))}
          {detail.cancellation.by ? (
            <View style={styles.cancelBox}>
              <Text style={styles.cancelTitle}>
                Cancelled by {CANCELLED_BY_LABEL[detail.cancellation.by] ?? detail.cancellation.by}
              </Text>
              {detail.cancellation.reason ? (
                <Text style={styles.cancelReason}>{detail.cancellation.reason}</Text>
              ) : null}
            </View>
          ) : null}
        </Card>

        <SectionTitle title="Fare breakdown" />
        <Card style={styles.card}>
          <FareRow label="Base fare" value={inr(fare.baseFare)} />
          <FareRow label="Distance" value={inr(fare.distanceFare)} />
          <FareRow label="Time" value={inr(fare.timeCharge)} />
          {fare.tollFee > 0 ? <FareRow label="Toll" value={inr(fare.tollFee)} /> : null}
          <FareRow label="Taxes" value={inr(fare.taxes)} />
          {fare.discount > 0 ? (
            <FareRow
              label={detail.promoCode ? `Promo ${detail.promoCode}` : 'Discount'}
              value={`-${inr(fare.discount)}`}
            />
          ) : null}
          <View style={styles.fareDivider} />
          <FareRow label="Total" value={inr(fare.total)} strong />
          {detail.tipAmount > 0 ? <FareRow label="Tip" value={inr(detail.tipAmount)} /> : null}
        </Card>

        <SectionTitle title="Payment" />
        <Card style={styles.card}>
          <View style={styles.payHead}>
            <StatusPill kind="payment" value={detail.paymentStatus} />
            <Text style={styles.payMarked}>{markedBy ?? 'Not marked yet'}</Text>
          </View>
          {detail.payments.length === 0 ? (
            <Text style={styles.hint}>No payment rows recorded for this ride.</Text>
          ) : (
            detail.payments.map((payment) => (
              <View key={payment.id} style={styles.payRow}>
                <View style={styles.payRowHead}>
                  <Text style={styles.payMethod}>
                    {METHOD_LABEL[payment.method]} · {inr(payment.amount, { decimals: true })}
                  </Text>
                  <StatusPill kind="payment" value={payment.status} />
                </View>
                <Text style={styles.payMeta} numberOfLines={1}>
                  {formatDateTimeIST(payment.createdAt)}
                  {payment.providerPaymentId ? ` · ${payment.providerPaymentId}` : ''}
                </Text>
              </View>
            ))
          )}
        </Card>

        <SectionTitle title="People" />
        <Card style={styles.card}>
          <View style={styles.personRow}>
            <Avatar name={detail.rider.name} size={40} />
            <View style={styles.personText}>
              <Text style={styles.personName}>{detail.rider.name}</Text>
              <Text style={styles.personMeta}>Rider · {maskPhone(detail.rider.phone)}</Text>
            </View>
          </View>
        </Card>
        {detail.driver ? (
          <Card
            style={styles.card}
            onPress={() => detail.driver && openDriverDetail(detail.driver.id)}
          >
            <View style={styles.personRow}>
              <Avatar name={detail.driver.name} size={40} />
              <View style={styles.personText}>
                <Text style={styles.personName}>{detail.driver.name}</Text>
                <Text style={styles.personMeta}>
                  {detail.driver.vehicleType}
                  {detail.driver.carModel ? ` · ${detail.driver.carModel}` : ''}
                  {detail.driver.plateNumber ? ` · ${detail.driver.plateNumber}` : ''}
                </Text>
                <Text style={styles.personMeta}>
                  {detail.driver.rating != null ? `★ ${detail.driver.rating.toFixed(1)} · ` : ''}
                  {maskPhone(detail.driver.phone)}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Card>
        ) : null}
        {!detail.driver && detail.status === 'cancelled' ? (
          <EmptyState title="No driver was matched" message="This ride was cancelled before a driver matched." />
        ) : null}
      </ScrollView>

      {canCancel || canResolve ? (
        <ActionBar>
          {canCancel ? (
            <Button
              title="Cancel ride"
              variant="danger"
              fullWidth={false}
              style={styles.actionBtn}
              loading={busy === 'cancel'}
              disabled={busy !== null && busy !== 'cancel'}
              onPress={() => openModal('cancel')}
            />
          ) : null}
          {canResolve ? (
            <>
              <Button
                title="Mark paid"
                variant="success"
                fullWidth={false}
                style={styles.actionBtn}
                loading={busy === 'paid'}
                disabled={busy !== null && busy !== 'paid'}
                onPress={() => openModal('paid')}
              />
              <Button
                title="Mark disputed"
                variant="outline"
                fullWidth={false}
                style={styles.actionBtn}
                loading={busy === 'disputed'}
                disabled={busy !== null && busy !== 'disputed'}
                onPress={() => openModal('disputed')}
              />
            </>
          ) : null}
        </ActionBar>
      ) : null}

      <ReasonModal
        visible={modal !== null}
        title={
          modal === 'cancel'
            ? 'Cancel ride'
            : modal === 'paid'
              ? 'Mark as paid'
              : 'Flag as disputed'
        }
        description={
          modal === 'cancel'
            ? 'Required — the rider and driver are notified (5–300 characters, audit trail).'
            : 'Note for the audit trail (5–300 characters) — who confirmed and how.'
        }
        value={reason}
        onChange={setReason}
        onSubmit={(value) => void submitModal(value)}
        onClose={() => setModal(null)}
        submitLabel={modal === 'cancel' ? 'Cancel ride' : modal === 'paid' ? 'Mark paid' : 'Flag dispute'}
        destructive={modal === 'cancel' || modal === 'disputed'}
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
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  route: {
    ...typography.cardTitle,
    fontSize: 15,
  },
  routeMeta: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: 4,
  },
  sectionTitle: {
    ...typography.cardTitle,
    marginTop: 20,
    marginBottom: 10,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotOn: {
    backgroundColor: colors.success,
  },
  dotOff: {
    backgroundColor: colors.border,
  },
  timelineLabel: {
    ...typography.body,
    fontSize: 14,
    flex: 1,
  },
  timelinePending: {
    color: colors.textMuted,
  },
  timelineTime: {
    ...typography.meta,
    color: colors.textSecondary,
    textAlign: 'right',
    flexShrink: 1,
  },
  cancelBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  cancelTitle: {
    ...typography.metaBold,
    color: colors.danger,
  },
  cancelReason: {
    ...typography.meta,
    color: colors.textPrimary,
    marginTop: 4,
    lineHeight: 19,
  },
  fareDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 6,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  fareLabel: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  fareValue: {
    ...typography.body,
    fontSize: 14,
  },
  fareLabelStrong: {
    ...typography.cardTitle,
  },
  fareValueStrong: {
    ...typography.cardTitle,
    color: colors.primary,
  },
  payHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  payMarked: {
    ...typography.meta,
    color: colors.textSecondary,
    flexShrink: 1,
    textAlign: 'right',
  },
  hint: {
    ...typography.meta,
    color: colors.textMuted,
  },
  payRow: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 8,
    marginTop: 6,
  },
  payRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  payMethod: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  payMeta: {
    ...typography.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  personText: {
    flex: 1,
  },
  personName: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  personMeta: {
    ...typography.meta,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    fontSize: 24,
    color: colors.textMuted,
  },
  actionBtn: {
    flex: 1,
  },
});
