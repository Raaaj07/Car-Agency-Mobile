import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Car, Navigation, ShieldCheck, ArrowRight } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';

interface Props {
  onNext: (role: 'rider' | 'driver') => void;
}

export const RoleSelectionScreen: React.FC<Props> = ({ onNext }) => {
  const [selectedRole, setSelectedRole] = useState<'rider' | 'driver'>('rider');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandText}>VAZHI CABS</Text>
        </View>

        <Text style={styles.title}>How would you like to use Vazhi today?</Text>
        <Text style={styles.subtitle}>Choose your role to customize your experience</Text>

        <View style={styles.cardsWrap}>
          {/* Rider Choice Card */}
          <Card
            onPress={() => setSelectedRole('rider')}
            selected={selectedRole === 'rider'}
            style={styles.roleCard}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                <Car size={30} color={colors.accent} />
              </View>
              <View style={[styles.radio, selectedRole === 'rider' && styles.radioActive]}>
                {selectedRole === 'rider' && <View style={styles.radioInner} />}
              </View>
            </View>

            <Text style={styles.cardTitle}>Book a Ride</Text>
            <Text style={styles.cardDesc}>
              Quick, comfortable, and affordable rides across the city at your fingertips.
            </Text>

            <View style={styles.featurePills}>
              <View style={styles.pill}><Text style={styles.pillText}>Fast Pickup</Text></View>
              <View style={styles.pill}><Text style={styles.pillText}>Transparent Pricing</Text></View>
            </View>
          </Card>

          {/* Driver Choice Card */}
          <Card
            onPress={() => setSelectedRole('driver')}
            selected={selectedRole === 'driver'}
            style={styles.roleCard}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: '#EEF2FF' }]}>
                <Navigation size={30} color={colors.primary} />
              </View>
              <View style={[styles.radio, selectedRole === 'driver' && styles.radioActive]}>
                {selectedRole === 'driver' && <View style={styles.radioInner} />}
              </View>
            </View>

            <Text style={styles.cardTitle}>Drive & Earn</Text>
            <Text style={styles.cardDesc}>
              Turn your trips into income. Flexible hours, instant payouts, and zero hidden fees.
            </Text>

            <View style={styles.featurePills}>
              <View style={styles.pill}><Text style={styles.pillText}>Daily Payouts</Text></View>
              <View style={styles.pill}><Text style={styles.pillText}>24/7 Support</Text></View>
            </View>
          </Card>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={`Continue as ${selectedRole === 'rider' ? 'Rider' : 'Driver'}`}
          onPress={() => onNext(selectedRole)}
          variant="primary"
          size="large"
          rightIcon={<ArrowRight size={20} color="#FFFFFF" />}
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
  },
  brandBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.pill,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  brandText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1.5,
  },
  title: {
    ...typography.heading,
    textAlign: 'center',
    fontSize: 26,
    marginBottom: 8,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: 28,
  },
  cardsWrap: {
    gap: 18,
  },
  roleCard: {
    padding: 22,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  cardTitle: {
    ...typography.subheading,
    marginBottom: 6,
  },
  cardDesc: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  featurePills: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  pillText: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.textSecondary,
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
