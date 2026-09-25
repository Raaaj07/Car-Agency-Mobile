import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { KeyRound, CheckCircle, RefreshCw } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { OTPInput } from '../../components/primitives/Input';
import { Header } from '../../components/primitives/Header';

interface Props {
  phone?: string;
  onBack: () => void;
  onVerify: () => void;
}

export const OTPVerificationScreen: React.FC<Props> = ({
  phone = '+91 98765 43210',
  onBack,
  onVerify,
}) => {
  const [code, setCode] = useState<string[]>(['', '', '', '']);
  const [timer, setTimer] = useState<number>(30);

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const isComplete = code.join('').length === 4;

  const handleResend = () => {
    setTimer(30);
    setCode(['', '', '', '']);
  };

  return (
    <View style={styles.container}>
      <Header title="OTP Verification" onBack={onBack} transparent />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.iconBadge}>
          <KeyRound size={28} color={colors.primary} />
        </View>

        <Text style={styles.title}>Enter OTP Code</Text>
        <Text style={styles.subtitle}>
          Code sent to <Text style={styles.phoneText}>{phone}</Text>
        </Text>

        <OTPInput code={code} setCode={setCode} length={4} />

        <View style={styles.resendRow}>
          {timer > 0 ? (
            <Text style={styles.timerText}>
              Resend OTP code in <Text style={styles.timerBold}>{timer}s</Text>
            </Text>
          ) : (
            <TouchableOpacity style={styles.resendBtn} onPress={handleResend}>
              <RefreshCw size={14} color={colors.accent} />
              <Text style={styles.resendText}>Resend OTP</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Verify & Continue"
          onPress={onVerify}
          variant="primary"
          size="large"
          disabled={!isComplete}
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
    alignItems: 'center',
  },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(33, 27, 78, 0.15)',
  },
  title: {
    ...typography.heading,
    fontSize: 26,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: 16,
  },
  phoneText: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  resendRow: {
    marginTop: 12,
  },
  timerText: {
    ...typography.meta,
    fontSize: 14,
    color: colors.textMuted,
  },
  timerBold: {
    color: colors.primary,
    fontWeight: '700',
  },
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resendText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.accent,
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
