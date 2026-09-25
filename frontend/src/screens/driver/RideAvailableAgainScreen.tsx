import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { DollarSign, CheckCircle2, Navigation, Home, Zap } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';

interface Props {
  onBackToDashboard: () => void;
}

export const RideAvailableAgainScreen: React.FC<Props> = ({ onBackToDashboard }) => {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Success Header Box */}
        <View style={styles.headerBox}>
          <View style={styles.iconCircleOuter}>
            <View style={styles.iconCircleInner}>
              <CheckCircle2 size={40} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.title}>Trip Completed!</Text>
          <Text style={styles.subtitle}>₹240.00 has been credited to your daily wallet</Text>
        </View>

        {/* Online Status Pill */}
        <View style={styles.onlineStatusCard}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>You are back Online & searching for nearby rides</Text>
        </View>

        {/* Finished Trip Breakdown */}
        <Card style={styles.summaryCard}>
          <Text style={styles.cardSectionTitle}>TRIP EARNINGS SUMMARY</Text>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Trip Fare</Text>
            <Text style={styles.metricVal}>₹210.00</Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Driver Tip</Text>
            <Text style={styles.metricVal}>₹30.00</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.metricRowTotal}>
            <Text style={styles.totalLabel}>Total Earned</Text>
            <Text style={styles.totalAmount}>₹240.00</Text>
          </View>
        </Card>

        {/* Surge Tip Banner */}
        <Card style={styles.surgeCard}>
          <Zap size={22} color={colors.accent} style={{ marginRight: 10 }} />
          <View style={styles.surgeTextWrap}>
            <Text style={styles.surgeTitle}>Stay in Indiranagar Area</Text>
            <Text style={styles.surgeSub}>High demand area with 1.4x surge bonus</Text>
          </View>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Go to Driver Dashboard"
          onPress={onBackToDashboard}
          variant="primary"
          size="large"
          leftIcon={<Home size={20} color="#FFFFFF" />}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 110,
    gap: 16,
  },
  headerBox: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 4,
  },
  iconCircleOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  iconCircleInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.heading,
    fontSize: 26,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
  },
  onlineStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    padding: 14,
    borderRadius: radii.card,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  onlineText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },
  summaryCard: {
    padding: 18,
  },
  cardSectionTitle: {
    ...typography.metaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 12,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metricLabel: {
    ...typography.body,
    fontSize: 13,
  },
  metricVal: {
    ...typography.bodyBold,
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 10,
  },
  metricRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    ...typography.cardTitle,
    fontSize: 15,
  },
  totalAmount: {
    ...typography.heading,
    fontSize: 22,
    color: colors.success,
  },
  surgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#FFF6ED',
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  surgeTextWrap: {
    flex: 1,
  },
  surgeTitle: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  surgeSub: {
    ...typography.meta,
    fontSize: 12,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    ...shadows.card,
  },
});
