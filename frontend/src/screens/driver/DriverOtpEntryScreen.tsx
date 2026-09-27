import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { KeyRound } from 'lucide-react-native';
import { colors, typography } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { OTPInput } from '../../components/primitives/Input';
import { Header } from '../../components/primitives/Header';

interface Props {
  onBack: () => void;
  onVerify: (otp: string) => void;
  isVerifying?: boolean;
  serverError?: string;
}

export const DriverOtpEntryScreen: React.FC<Props> = ({ onBack, onVerify, isVerifying, serverError }) => {
  const [code, setCode] = useState<string[]>(['', '', '', '']);
  const isComplete = code.join('').length === 4;

  return (
    <View style={styles.container}>
      <Header title="Confirm Pickup" onBack={onBack} transparent />
      <View style={styles.content}>
        <View style={styles.iconBadge}>
          <KeyRound size={28} color={colors.primary} />
        </View>
        <Text style={styles.title}>Ask the rider for their code</Text>
        <Text style={styles.subtitle}>Enter the 4-digit pickup code shown on their app</Text>
        <OTPInput code={code} setCode={setCode} length={4} />
        {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
      </View>
      <View style={styles.footer}>
        <Button
          title="Start Trip"
          onPress={() => onVerify(code.join(''))}
          variant="primary"
          size="large"
          disabled={!isComplete || isVerifying}
          loading={isVerifying}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: 24, alignItems: 'center' },
  iconBadge: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', marginTop: 20, marginBottom: 20,
  },
  title: { ...typography.heading, fontSize: 22, textAlign: 'center', marginBottom: 8 },
  subtitle: { ...typography.body, textAlign: 'center', marginBottom: 20 },
  error: { ...typography.meta, fontSize: 13, color: colors.danger, marginTop: 12, textAlign: 'center' },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF',
    padding: 20, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
});