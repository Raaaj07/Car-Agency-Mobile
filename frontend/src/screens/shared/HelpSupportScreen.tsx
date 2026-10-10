import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { Phone, Mail } from 'lucide-react-native';
import { colors, radii, typography } from '../../theme/theme';
import { Header } from '../../components/primitives/Header';
import { Card } from '../../components/primitives/Card';

// Owner: replace these two placeholders with the real support contacts
// before release (they are the only contact data in the app).
const SUPPORT_PHONE = '+91 98765 43210';
const SUPPORT_EMAIL = 'support@vazhi.app';

interface Props {
  onBack: () => void;
}

// Shared Help & support destination for BOTH rider and driver profiles —
// opens the dialer / mail client, no backend involved.
export const HelpSupportScreen: React.FC<Props> = ({ onBack }) => {
  const openLink = async (url: string, what: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Cannot open', `No ${what} app is available on this device.`);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Help & support" onBack={onBack} transparent />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Text style={styles.title}>We&apos;re here to help</Text>
          <Text style={styles.body}>
            Questions about a ride, a payment or your account? Reach the Vazhi team through any of
            the options below.
          </Text>
        </Card>

        <Card style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => openLink(`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`, 'dialer')}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <View style={styles.rowIcon}>
              <Phone size={18} color={colors.primary} />
            </View>
            <View style={styles.rowTexts}>
              <Text style={styles.rowTitle}>Call support</Text>
              <Text style={styles.rowSub}>{SUPPORT_PHONE}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.row}
            onPress={() => openLink(`mailto:${SUPPORT_EMAIL}`, 'email')}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <View style={styles.rowIcon}>
              <Mail size={18} color={colors.primary} />
            </View>
            <View style={styles.rowTexts}>
              <Text style={styles.rowTitle}>Email us</Text>
              <Text style={styles.rowSub}>{SUPPORT_EMAIL}</Text>
            </View>
          </TouchableOpacity>
        </Card>

        <Text style={styles.hint}>
          For issues with a specific trip, keep your ride ID handy — it helps us find the trip
          instantly.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  card: { marginBottom: 16 },
  title: { ...typography.cardTitle, fontSize: 18, marginBottom: 6 },
  body: { ...typography.body, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTexts: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyBold, fontSize: 15 },
  rowSub: { ...typography.meta, fontSize: 13, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 10 },
  hint: { ...typography.meta, fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
});
