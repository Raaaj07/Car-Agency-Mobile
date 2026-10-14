import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';

export const HEADER_BAR_HEIGHT = 56;

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  transparent?: boolean;
  style?: ViewStyle;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onBack,
  rightAction,
  transparent = false,
  style,
}) => {
  // Every stack screen runs with `headerShown: false` and (on Android 15+ /
  // edge-to-edge) draws under the status bar, so the header has to add the
  // top safe-area inset itself — otherwise the back arrow and title sit
  // underneath the status bar / camera cutout and cannot be seen or tapped.
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        { height: HEADER_BAR_HEIGHT + insets.top, paddingTop: insets.top },
        transparent ? styles.transparent : styles.solid,
        style,
      ]}
    >
      {onBack ? (
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.placeholder} />
      )}

      <View style={styles.titleWrap}>
        {title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
        {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>

      {rightAction ? (
        <View style={styles.rightWrap}>{rightAction}</View>
      ) : (
        <View style={styles.placeholder} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  solid: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  transparent: { backgroundColor: 'transparent' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  titleWrap: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  title: { ...typography.cardTitle, fontSize: 17 },
  subtitle: { ...typography.meta },
  rightWrap: { minWidth: 40, alignItems: 'flex-end' },
  placeholder: { width: 40 },
});
