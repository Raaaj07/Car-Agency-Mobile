import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Phone, ShieldCheck } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

interface Props {
  onMobileSignIn: () => void;
  onGoogleToken: (idToken: string) => void;
  onAppleToken: (identityToken: string, fullName?: string) => void;
  isAuthenticating?: boolean;
  authError?: string;
}

export const SignInScreen: React.FC<Props> = ({
  onMobileSignIn,
  onGoogleToken,
  onAppleToken,
  isAuthenticating,
  authError,
}) => {
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    responseType: 'id_token',
    scopes: ['openid', 'profile', 'email'],
  });

  // Always-fresh callback for the response effect (exhaustive-deps): adding
  // onGoogleToken to the deps would re-submit the same token on every parent
  // re-render, so the effect reads a ref instead.
  const onGoogleTokenRef = useRef(onGoogleToken);
  useEffect(() => {
    onGoogleTokenRef.current = onGoogleToken;
  });

  useEffect(() => {
    if (response?.type === 'success') {
      // Depending on how the response is shaped, the token can land in
      // either place — check both so we're not silently missing it.
      const idToken = response.authentication?.idToken ?? (response.params as any)?.id_token;
      if (idToken) {
        onGoogleTokenRef.current(idToken);
      } else {
        console.log('Google auth succeeded but no idToken found. Full response:', JSON.stringify(response));
      }
    } else if (response?.type === 'error') {
      console.log('Google auth error:', response.error);
    } else if (response) {
      console.log('Google auth response type:', response.type);
    }
  }, [response]);

  const handleApple = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.identityToken) {
        const fullName = credential.fullName?.givenName
          ? `${credential.fullName.givenName} ${credential.fullName.familyName ?? ''}`.trim()
          : undefined;
        onAppleToken(credential.identityToken, fullName);
      }
    } catch (err: any) {
      if (err.code !== 'ERR_REQUEST_CANCELED') console.warn('Apple sign-in failed', err);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

          {authError ? <Text style={styles.authErrorText}>{authError}</Text> : null}

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
            <TouchableOpacity
              style={styles.socialBtn}
              disabled={!request || isAuthenticating}
              onPress={() => promptAsync()}
            >
              <Text style={styles.socialIconText}>G</Text>
              <Text style={styles.socialBtnText}>Google</Text>
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.socialBtn} disabled={isAuthenticating} onPress={handleApple}>
                <Text style={styles.socialIconText}></Text>
                <Text style={styles.socialBtnText}>Apple</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={styles.termsFooter}>
        <ShieldCheck size={16} color={colors.textMuted} />
        <Text style={styles.termsText}>
          By continuing, you agree to Vazhi&apos;s <Text style={styles.linkText}>Terms</Text> & <Text style={styles.linkText}>Privacy Policy</Text>
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary },
  scrollContent: { paddingBottom: 60 },
  heroBox: { alignItems: 'center', paddingTop: 50, paddingBottom: 36 },
  heroCircleOuter: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(224, 138, 52, 0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  heroCircleInner: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { color: '#FFFFFF', fontSize: 40, fontWeight: '900' },
  brandTitle: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', letterSpacing: 4 },
  brandSubtitle: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 14, marginTop: 4 },
  formCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    padding: 24, minHeight: 440,
  },
  welcomeText: { ...typography.heading, fontSize: 26, textAlign: 'center', marginBottom: 6, marginTop: 8 },
  subText: { ...typography.body, textAlign: 'center', marginBottom: 28 },
  authErrorText: {
    color: '#EF4444',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  mobileBtn: { marginBottom: 24 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { ...typography.metaBold, fontSize: 11, color: colors.textMuted, marginHorizontal: 12 },
  socialButtons: { flexDirection: 'row', gap: 14 },
  socialBtn: {
    flex: 1, height: 50, backgroundColor: '#FFFFFF',
    borderRadius: radii.button, borderWidth: 1, borderColor: '#E5E7EB',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, ...shadows.card,
  },
  socialIconText: { fontSize: 18, fontWeight: '700' },
  socialBtnText: { ...typography.bodyBold, fontSize: 14, color: colors.textPrimary },
  termsFooter: {
    position: 'absolute', bottom: 16, left: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  termsText: { ...typography.meta, fontSize: 12, color: colors.textMuted },
  linkText: { color: colors.primary, fontWeight: '600' },
});