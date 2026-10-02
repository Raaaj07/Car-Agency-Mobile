import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { Camera, CheckCircle2 } from 'lucide-react-native';
// NOTE: expo-image-picker is loaded lazily inside pick() so the app still
// runs in Expo Go without the native module (upload shows an alert instead
// of a red-screen crash). Requires a dev build for real uploads.
import { colors, radii, typography } from '../../theme/theme';

interface Props {
  label: string;
  hint?: string;
  value?: string | null;
  onChange: (uri: string | null) => void;
  loading?: boolean;
}

export const DocumentUploader: React.FC<Props> = ({ label, hint, value, onChange, loading }) => {
  const pick = async (fromCamera: boolean) => {
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = await import('expo-image-picker');
    } catch {
      Alert.alert(
        'Image upload unavailable',
        'This preview build (Expo Go) has no image-picker native module. Use a development build (npx expo run:android) for document uploads.',
      );
      return;
    }
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') return;
      const fn = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const res = await fn({ mediaTypes: ['images'], quality: 0.7, base64: false });
      if (!res.canceled && res.assets?.[0]?.uri) onChange(res.assets[0].uri);
    } catch {
      Alert.alert('Image picker failed', 'Please try again or use a development build.');
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.row}>
        <TouchableOpacity style={styles.box} onPress={() => pick(false)} activeOpacity={0.8}>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : value ? (
            <Image source={{ uri: value }} style={styles.img} />
          ) : (
            <>
              <Camera size={22} color={colors.primary} />
              <Text style={styles.boxText}>Upload</Text>
            </>
          )}
          {value ? (
            <View style={styles.check}>
              <CheckCircle2 size={18} color={colors.success} />
            </View>
          ) : null}
        </TouchableOpacity>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btn} onPress={() => pick(false)}>
            <Text style={styles.btnText}>{value ? 'Change photo' : 'Gallery'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => pick(true)}>
            <Text style={styles.btnText}>Camera</Text>
          </TouchableOpacity>
          {value ? (
            <TouchableOpacity onPress={() => onChange(null)}>
              <Text style={styles.remove}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  label: { ...typography.bodyBold, fontSize: 14, marginBottom: 2 },
  hint: { ...typography.meta, fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  box: {
    width: 96, height: 96, borderRadius: radii.card, backgroundColor: '#F1F5F9',
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  boxText: { ...typography.metaBold, fontSize: 11, color: colors.primary, marginTop: 4 },
  img: { width: 96, height: 96, borderRadius: radii.card },
  check: { position: 'absolute', top: 4, right: 4, backgroundColor: '#fff', borderRadius: 10 },
  actions: { flex: 1, gap: 8 },
  btn: { backgroundColor: '#EEF2FF', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radii.pill, alignSelf: 'flex-start' },
  btnText: { ...typography.bodyBold, fontSize: 13, color: colors.primary },
  remove: { ...typography.metaBold, fontSize: 12, color: colors.danger, marginTop: 2 },
});
