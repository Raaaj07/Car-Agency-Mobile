import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Phone, ArrowRight, ShieldCheck } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Input';
import { Header } from '../../components/primitives/Header';

interface Props {
  onBack: () => void;
  onSendOTP: (phone: string) => void;
}

export const MobileNumberScreen: React.FC<Props> = ({ onBack, onSendOTP }) => {
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleSubmit = () => {
    if (phoneNumber.length < 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setError('');
    onSendOTP(phoneNumber);
  };

  return (
    <View style={styles.container}>
      <Header title="Mobile Verification" onBack={onBack} transparent />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.iconBadge}>
          <Phone size={28} color={colors.accent} />
        </View>

        <Text style={styles.title}>Enter Your Mobile Number</Text>
        <Text style={styles.subtitle}>
          We will send a 4-digit verification code to confirm your account
        </Text>

        <View style={styles.formSection}>
          <Input
            label="Mobile Number"
            value={phoneNumber}
            onChangeText={(text) => {
              setPhoneNumber(text.replace(/[^0-9]/g, ''));
              if (error) setError('');
            }}
            placeholder="98765 43210"
            isPhoneInput
            countryCode="+91"
            keyboardType="phone-pad"
            maxLength={10}
            error={error}
            autoFocus
          />

          <View style={styles.infoBox}>
            <ShieldCheck size={18} color={colors.primary} />
            <Text style={styles.infoText}>
              Your phone number will be used for ride updates & driver communication.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Send OTP Code"
          onPress={handleSubmit}
          variant="primary"
          size="large"
          disabled={phoneNumber.length < 10}
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
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  title: {
    ...typography.heading,
    fontSize: 26,
    marginBottom: 8,
  },
  subtitle: {
    ...typography.body,
    marginBottom: 28,
  },
  formSection: {
    gap: 8,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    padding: 14,
    borderRadius: radii.md,
    gap: 10,
    marginTop: 8,
  },
  infoText: {
    ...typography.meta,
    fontSize: 12,
    color: colors.primary,
    flex: 1,
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
