import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, Alert, TextInput } from 'react-native';
import { colors, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Header } from '../../components/primitives/Header';
import { adminApi, ApplicationDetail } from '../../api/admin';
import { getApiError } from '../../api/client';

interface Props {
  applicationId: string;
  onBack: () => void;
  onChanged: () => void;
}

function DocImage({ appId, kind, label }: { appId: string; kind: 'licenseImage' | 'rcImage' | 'vehiclePhoto'; label: string }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    adminApi
      .file(appId, kind)
      .then((f) => {
        if (live) setUri(`data:${f.mime};base64,${f.base64}`);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [appId, kind]);
  return (
    <View style={styles.docWrap}>
      <Text style={styles.docLabel}>{label}</Text>
      {uri ? (
        <Image source={{ uri }} style={styles.docImg} resizeMode="contain" />
      ) : (
        <Text style={styles.docMissing}>{failed ? 'Document unavailable' : 'Loading…'}</Text>
      )}
    </View>
  );
}

export const AdminApplicationDetailScreen: React.FC<Props> = ({ applicationId, onBack, onChanged }) => {
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setApp(await adminApi.get(applicationId));
    } catch (err) {
      Alert.alert('Failed to load application', getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const doApprove = () => {
    Alert.alert('Approve application?', `${app?.applicantName} will be able to go online as a driver.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setActing(true);
          try {
            setApp(await adminApi.approve(applicationId));
            onChanged();
          } catch (err) {
            Alert.alert('Approve failed', getApiError(err));
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  };

  const doReject = () => {
    const r = reason.trim();
    if (r.length < 5 || r.length > 300) {
      Alert.alert('Reason required', 'Please enter a reason between 5 and 300 characters.');
      return;
    }
    Alert.alert('Reject application?', 'The applicant will see this reason and can re-apply.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setActing(true);
          try {
            setApp(await adminApi.reject(applicationId, r));
            setReason('');
            onChanged();
          } catch (err) {
            Alert.alert('Reject failed', getApiError(err));
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  };

  if (loading || !app) {
    return (
      <View style={styles.container}>
        <Header title="Application" onBack={onBack} />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Application" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Text style={styles.name}>{app.applicantName}</Text>
          <Text style={styles.sub}>{app.phone}{app.email ? ` · ${app.email}` : ''}</Text>
          <Text style={styles.sub}>Status: {app.status}</Text>
          <Text style={styles.sub}>Vehicle: {app.carModel} · {app.plateNumber} · {app.vehicleType.toUpperCase()}</Text>
          <Text style={styles.sub}>Licence: {app.licenseNumber ?? '—'}</Text>
          <Text style={styles.sub}>RC: {app.rcNumber ?? '—'}</Text>
          {app.rejectionReason ? <Text style={styles.reason}>Reason: {app.rejectionReason}</Text> : null}
        </Card>

        {app.hasLicenseImage && <DocImage appId={app.id} kind="licenseImage" label="Driving licence" />}
        {app.hasRcImage && <DocImage appId={app.id} kind="rcImage" label="RC book" />}
        {app.hasVehiclePhoto && <DocImage appId={app.id} kind="vehiclePhoto" label="Vehicle photo" />}

        {(app.status === 'pending' || app.status === 'rejected') && (
          <Card style={styles.card}>
            <Text style={styles.actionTitle}>Review</Text>
            <TextInput
              style={styles.input}
              placeholder="Rejection reason (required to reject, 5–300 chars)"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={300}
            />
            <View style={styles.btnRow}>
              <Button title="Approve" onPress={doApprove} loading={acting} style={styles.btn} />
              <Button title="Reject" variant="danger" onPress={doReject} loading={acting} style={styles.btn} />
            </View>
          </Card>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  card: { gap: 4 },
  name: { ...typography.cardTitle, fontSize: 18 },
  sub: { ...typography.meta, fontSize: 13 },
  reason: { ...typography.bodyBold, fontSize: 13, color: colors.danger, marginTop: 6 },
  docWrap: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 8 },
  docLabel: { ...typography.bodyBold, fontSize: 14 },
  docImg: { width: '100%', height: 220, backgroundColor: '#F1F5F9', borderRadius: 8 },
  docMissing: { ...typography.meta, color: colors.textMuted },
  actionTitle: { ...typography.cardTitle, fontSize: 16, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 80, textAlignVertical: 'top', marginBottom: 12 },
  btnRow: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1 },
});
