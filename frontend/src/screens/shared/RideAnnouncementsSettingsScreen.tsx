import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity } from 'react-native';
import { Volume2, BellRing, Globe, ShieldAlert, Check } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Header } from '../../components/primitives/Header';

interface Props {
  onBack: () => void;
  onSave: () => void;
}

export const RideAnnouncementsSettingsScreen: React.FC<Props> = ({ onBack, onSave }) => {
  const [voiceAlerts, setVoiceAlerts] = useState<boolean>(true);
  const [arrivalChime, setArrivalChime] = useState<boolean>(true);
  const [speedAlerts, setSpeedAlerts] = useState<boolean>(false);
  const [voiceLang, setVoiceLang] = useState<string>('English');
  const [volume, setVolume] = useState<'Soft' | 'Normal' | 'Loud'>('Normal');

  return (
    <View style={styles.container}>
      <Header title="Audio Announcements" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Main Audio Voice Prompts Card */}
        <Card style={styles.cardSection}>
          <Text style={styles.cardHeaderTitle}>AUDIO & VOICE ALERTS</Text>

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>Voice Navigation Prompts</Text>
              <Text style={styles.switchSub}>Turn-by-turn spoken directions</Text>
            </View>
            <Switch
              value={voiceAlerts}
              onValueChange={setVoiceAlerts}
              trackColor={{ false: colors.border, true: colors.accentLight }}
              thumbColor={voiceAlerts ? colors.accent : '#9CA3AF'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>Driver Arrival Audio Chime</Text>
              <Text style={styles.switchSub}>Play loud alert when driver is 1 min away</Text>
            </View>
            <Switch
              value={arrivalChime}
              onValueChange={setArrivalChime}
              trackColor={{ false: colors.border, true: colors.accentLight }}
              thumbColor={arrivalChime ? colors.accent : '#9CA3AF'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>Over-Speed & Safety Warnings</Text>
              <Text style={styles.switchSub}>Alert if vehicle exceeds speed limit</Text>
            </View>
            <Switch
              value={speedAlerts}
              onValueChange={setSpeedAlerts}
              trackColor={{ false: colors.border, true: colors.accentLight }}
              thumbColor={speedAlerts ? colors.accent : '#9CA3AF'}
            />
          </View>
        </Card>

        {/* Announcement Language Choice */}
        <Card style={styles.cardSection}>
          <Text style={styles.cardHeaderTitle}>VOICE LANGUAGE</Text>
          <View style={styles.langGrid}>
            {['English', 'Tamil (தமிழ்)', 'Hindi (हिंदी)'].map((lang) => {
              const isSelected = voiceLang === lang;
              return (
                <TouchableOpacity
                  key={lang}
                  style={[styles.langChip, isSelected && styles.langChipActive]}
                  onPress={() => setVoiceLang(lang)}
                >
                  <Text style={[styles.langChipText, isSelected && styles.langChipTextActive]}>
                    {lang}
                  </Text>
                  {isSelected && <Check size={14} color="#FFFFFF" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Volume Level Options */}
        <Card style={styles.cardSection}>
          <Text style={styles.cardHeaderTitle}>ANNOUNCEMENT VOLUME</Text>
          <View style={styles.volRow}>
            {(['Soft', 'Normal', 'Loud'] as const).map((v) => {
              const isSelected = volume === v;
              return (
                <TouchableOpacity
                  key={v}
                  style={[styles.volChip, isSelected && styles.volChipActive]}
                  onPress={() => setVolume(v)}
                >
                  <Volume2 size={16} color={isSelected ? '#FFFFFF' : colors.textPrimary} />
                  <Text style={[styles.volText, isSelected && styles.volTextActive]}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>
      </ScrollView>

      {/* Footer Save Button */}
      <View style={styles.footer}>
        <Button
          title="Save Audio Preferences"
          onPress={onSave}
          variant="primary"
          size="large"
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
    padding: 20,
    paddingBottom: 110,
    gap: 16,
  },
  cardSection: {
    padding: 18,
  },
  cardHeaderTitle: {
    ...typography.metaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 14,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  switchTitle: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  switchSub: {
    ...typography.meta,
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 12,
  },
  langGrid: {
    gap: 10,
  },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  langChipText: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  langChipTextActive: {
    color: '#FFFFFF',
  },
  volRow: {
    flexDirection: 'row',
    gap: 10,
  },
  volChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radii.button,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  volChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  volText: {
    ...typography.bodyBold,
    fontSize: 13,
  },
  volTextActive: {
    color: '#FFFFFF',
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
