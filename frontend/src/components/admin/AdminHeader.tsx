import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';

interface AdminHeaderProps {
  title: string;
  /** Hero only: "Good morning, Priya" style greeting above the title. */
  greeting?: string;
  /** Hero only: date / supporting line under the title. */
  subtitle?: string;
  /**
   * `hero` — navy banner with safe-area padding (list/tab screens).
   * `plain` — flat header for pushed detail screens.
   */
  variant?: 'hero' | 'plain';
  /** Right-aligned slot (e.g. avatar or action icon). */
  right?: React.ReactNode;
  /** Render a back button (detail screens; headerShown is false everywhere). */
  onBack?: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  title,
  greeting,
  subtitle,
  variant = 'hero',
  right,
  onBack,
}) => {
  const insets = useSafeAreaInsets();
  const hero = variant === 'hero';

  return (
    <View
      style={[
        styles.base,
        hero ? styles.hero : styles.plain,
        hero ? { paddingTop: insets.top + 12 } : { paddingTop: insets.top + 8 },
      ]}
    >
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          style={styles.back}
        >
          <ArrowLeft size={22} color={hero ? colors.textLight : colors.textPrimary} />
        </TouchableOpacity>
      ) : null}
      <View style={styles.textCol}>
        {greeting ? <Text style={styles.greeting}>{greeting}</Text> : null}
        <Text style={[styles.title, hero && styles.titleHero]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, !hero && styles.subtitlePlain]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  back: {
    marginRight: 12,
    paddingBottom: 4,
  },
  hero: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  plain: {
    backgroundColor: 'transparent',
    paddingBottom: 10,
  },
  textCol: {
    flex: 1,
    marginRight: 12,
  },
  greeting: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
    marginBottom: 4,
  },
  title: {
    ...typography.heading,
  },
  titleHero: {
    color: colors.textLight,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textLight,
    opacity: 0.8,
    marginTop: 4,
  },
  subtitlePlain: {
    color: colors.textSecondary,
    opacity: 1,
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingBottom: 2,
  },
});
