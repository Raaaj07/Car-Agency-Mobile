import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Check, Globe } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';

interface LanguageOption {
  id: string;
  name: string;
  nativeName: string;
}

const languages: LanguageOption[] = [
  { id: 'en', name: 'English', nativeName: 'English' },
  { id: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { id: 'hi', name: 'Hindi', nativeName: 'हिंदी' },
  { id: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { id: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { id: 'kn', name: 'Kannada', nativeName: '<ctrl42><ctrl42>' },
];

interface Props {
  onNext: () => void;
}

export const LanguageSelectionScreen: React.FC<Props> = ({ onNext }) => {
  const [selectedLang, setSelectedLang] = useState<string>('en');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Globe size={32} color={colors.primary} />
          </View>
          <Text style={styles.title}>Choose Your Language</Text>
          <Text style={styles.subtitle}>Select your preferred language to get started with Vazhi</Text>
        </View>

        <View style={styles.grid}>
          {languages.map((lang) => {
            const isSelected = selectedLang === lang.id;
            return (
              <Card
                key={lang.id}
                onPress={() => setSelectedLang(lang.id)}
                selected={isSelected}
                style={styles.langCard}
              >
                <View style={styles.langRow}>
                  <View style={styles.langTextWrap}>
                    <Text style={[styles.langNative, isSelected && styles.langNativeActive]}>
                      {lang.nativeName}
                    </Text>
                    <Text style={styles.langName}>{lang.name}</Text>
                  </View>
                  <View style={[styles.radio, isSelected && styles.radioActive]}>
                    {isSelected && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Continue" onPress={onNext} variant="primary" size="large" />
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
    paddingBottom: 100,
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 32,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.2)',
  },
  title: {
    ...typography.heading,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
    maxWidth: 280,
  },
  grid: {
    gap: 14,
  },
  langCard: {
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  langTextWrap: {},
  langNative: {
    ...typography.cardTitle,
    fontSize: 19,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  langNativeActive: {
    color: colors.primary,
  },
  langName: {
    ...typography.meta,
    fontSize: 13,
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
    borderColor: colors.accent,
    backgroundColor: colors.accent,
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
