import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { X, ExternalLink, RotateCcw } from 'lucide-react-native';
import { Button } from '../primitives/Button';
import { colors, radii, shadows, typography } from '../../theme/theme';

interface DocumentViewerModalProps {
  visible: boolean;
  title: string;
  mime: string | null;
  /** Signed, short-lived URL (Cloudinary docs). */
  url: string | null;
  /** Legacy inline fallback (local-disk docs). */
  base64?: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Called on error state / expired signed URL ("refetch" per spec §3.2). */
  onRetry?: () => void;
}

/**
 * Fullscreen document viewer: images zoom inside a scroll view (iOS pinch;
 * double-tap-free on Android where ScrollView zoom is not available), PDFs
 * hand off to the system viewer, failures offer a refetch of the signed URL.
 */
export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  visible,
  title,
  mime,
  url,
  base64,
  loading = false,
  error = null,
  onClose,
  onRetry,
}) => {
  const { height } = useWindowDimensions();
  const isImage = !!mime?.startsWith('image/');
  const isPdf = mime === 'application/pdf';

  const source = url ?? (base64 && mime ? `data:${mime};base64,${base64}` : null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { maxHeight: height * 0.88 }]}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close document viewer"
              hitSlop={10}
              style={styles.close}
            >
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.hint}>Loading document…</Text>
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                {onRetry ? (
                  <Button
                    title="Refetch"
                    variant="outline"
                    size="small"
                    fullWidth={false}
                    onPress={onRetry}
                    leftIcon={<RotateCcw size={16} color={colors.primary} />}
                    style={styles.retryBtn}
                  />
                ) : null}
              </View>
            ) : !source ? (
              <View style={styles.center}>
                <Text style={styles.hint}>Document is not available.</Text>
              </View>
            ) : isImage ? (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                maximumZoomScale={3}
                minimumZoomScale={1}
                centerContent
              >
                <Image source={{ uri: source }} style={styles.image} resizeMode="contain" />
              </ScrollView>
            ) : isPdf && url ? (
              <View style={styles.center}>
                <Text style={styles.hint}>PDF preview is not available inline.</Text>
                <Button
                  title="Open PDF"
                  variant="primary"
                  size="medium"
                  fullWidth={false}
                  onPress={() => void Linking.openURL(url)}
                  leftIcon={<ExternalLink size={16} color={colors.textLight} />}
                  style={styles.openBtn}
                />
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.hint}>Preview is not available for this file type.</Text>
                {url ? (
                  <Button
                    title="Open file"
                    variant="outline"
                    size="small"
                    fullWidth={false}
                    onPress={() => void Linking.openURL(url)}
                    leftIcon={<ExternalLink size={16} color={colors.primary} />}
                    style={styles.openBtn}
                  />
                ) : null}
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    overflow: 'hidden',
    ...shadows.modal,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  title: {
    ...typography.cardTitle,
    flex: 1,
    marginRight: 12,
  },
  close: {
    padding: 2,
  },
  content: {
    padding: 12,
    minHeight: 260,
  },
  scroll: {
    borderRadius: radii.md,
  },
  scrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  image: {
    width: '100%',
    height: 420,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  hint: {
    ...typography.body,
    textAlign: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  retryBtn: {
    marginTop: 4,
  },
  openBtn: {
    marginTop: 4,
  },
});
