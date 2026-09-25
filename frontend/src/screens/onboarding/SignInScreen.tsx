import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Phone, ShieldCheck, Mail, ArrowRight } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';

interface Props {
  onMobileSignIn: () => void;
  onSocialSignIn?: () => void;
}

export const SignInScreen: React.FC<Props> = ({ onMobileSignIn, onSocialSignIn }) => {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Brand Banner Hero */}
        <View style={styles.heroBox}>
          <View style={styles.heroCircleOuter}>
            <View style={styles.heroCircleInner}>
              <Text style={styles.logoText}>V</Text>
            </View>
          </View>
          <Text style={styles.brandTitle}>VAZHI</Text>
          <Text style={styles.brandSubtitle}>Your Journey, Made Simple</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.welcomeText}>Welcome Back!</Text>
          <Text style={styles.subText}>Sign in or create an account to start booking rides</Text>

          <Button
            title="Continue with Mobile Number"
            onPress={onMobileSignIn}
            variant="primary"
            size="large"
            leftIcon={<Phone size={20} color="#FFFFFF" />}
            style={styles.mobileBtn}
          />

          <View style={styles.dividerRow}>
            <View style={styles.line} />
            <Text style={styles.orText}>OR CONTINUE WITH</Text>
            <View style={styles.line} />
          </View>

          <View style={styles.socialButtons}>
            <TouchableOpacity style={styles.socialBtn} onPress={onSocialSignIn}>
              <Text style={styles.socialIconText}>G</Text>
              <Text style={styles.socialBtnText}>Google</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.socialBtn} onPress={onSocialSignIn}>
              <Text style={styles.socialIconText}></Text>
              <Text style={styles.socialBtnText}>Apple</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <View style={styles.termsFooter}>
        <ShieldCheck size={16} color={colors.textMuted} />
        <Text style={styles.termsText}>
          By continuing, you agree to Vazhi's <Text style={styles.linkText}>Terms</Text> & <Text style={styles.linkText}>Privacy Policy</Text>
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  heroBox: {
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 36,
  },
  heroCircleOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(224, 138, 52, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroCircleInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '900',
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 4,
  },
  brandSubtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    marginTop: 4,
  },
  formCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    minHeight: 440,
  },
  welcomeText: {
    ...typography.heading,
    fontSize: 26,
    textAlign: 'center',
    marginBottom: 6,
    marginTop: 8,
  },
  subText: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: 28,
  },
  mobileBtn: {
    marginBottom: 24,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  orText: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.textMuted,
    marginHorizontal: 12,
  },
  socialButtons: {
    flexDirection: 'row',
    gap: 14,
  },
  socialBtn: {
    flex: 1,
    height: 50,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadows.card,
  },
  socialIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  socialBtnText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  termsFooter: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  termsText: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textMuted,
  },
  linkText: {
    color: colors.primary,
    fontWeight: '600',
  },
});
