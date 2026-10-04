import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  title,
  greeting,
  subtitle,
  variant = 'hero',
  right,
}) => {
  const insets = useSafeAreaInsets();
  const hero = variant === 'hero';

  return (
    <View
      style={[
        styles.base,
        hero ? styles.hero : styles.plain,
        hero ? { paddingTop: insets.top + 12 } : { paddingTop: 8 },
      ]}
    >
      <View style={styles.textCol}>
        {greeting ? <Text style={styles.greeting}>{greeting}</Text> : null}
        <Text style={[styles.title, hero && styles.titleHero]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
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
  right: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingBottom: 2,
  },
});
