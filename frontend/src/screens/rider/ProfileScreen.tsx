import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { LogOut, Mail, Phone, Edit2 } from 'lucide-react-native';
import { colors, typography, radii } from '../../theme/theme';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../api/auth';
import { getApiError } from '../../api/client';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';

export const ProfileScreen: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateUser = useAuthStore((s) => s.updateUser);

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Avatar name={user?.name ?? '?'} uri={user?.avatar} size={72} />
        {!isEditing && <Text style={styles.name}>{user?.name}</Text>}
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

      <Button
        title="Log out"
        variant="ghost"
        onPress={() =>
          Alert.alert('Log out?', 'You will need to sign in again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: logout },
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
  content: { padding: 24, paddingTop: 60 },
  header: { alignItems: 'center', marginBottom: 24 },
  name: { ...typography.heading, fontSize: 22, marginTop: 12 },
  card: { marginBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowText: { ...typography.body, color: colors.textPrimary },
  editTrigger: { marginTop: 12 },
  editRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  editBtn: { flex: 1 },
  logoutBtn: { marginTop: 8 },
});