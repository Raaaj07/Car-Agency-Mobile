import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Phone, ShieldCheck } from 'lucide-react-native';
import { FocusedStatusBar } from '../../components/primitives/FocusedStatusBar';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

// Native Google sign-in. The ID token it returns is issued for the WEB client
// id (webClientId), which is exactly the audience the backend verifies
// (GOOGLE_WEB_CLIENT_ID). The Android OAuth client in Google Cloud (package +
// SHA-1) is what authorises this app to ask; it is never sent to the backend.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  scopes: ['profile', 'email'],
});

// A client ID is a public identifier (not a secret). Showing its first part in
// the error tells us, without a debugger, which value this build baked in.
const webClientHint = GOOGLE_WEB_CLIENT_ID
  ? `${GOOGLE_WEB_CLIENT_ID.slice(0, 22)}…`
  : 'NOT SET';

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
  const [googleBusy, setGoogleBusy] = useState(false);
  const insets = useSafeAreaInsets();
  // Release builds have no visible console, so a Google failure used to look
  // like "nothing happened". Show a short, non-sensitive reason on screen
  // (status code only — never tokens or the raw error object).
  const [googleError, setGoogleError] = useState<string | undefined>();

  const handleGoogle = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    setGoogleError(undefined);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        // User dismissed the account picker — not an error.
        return;
      }
      if (response.data.idToken) {
        onGoogleToken(response.data.idToken);
      } else {
        // No idToken almost always means webClientId was undefined in this
        // build (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID missing at bundle time).
        setGoogleError(
          'Google did not return a sign-in token. This build is missing the Google web client ID — rebuild the app.',
        );
      }
    } catch (err) {
      if (isErrorWithCode(err)) {
        if (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS) return;
        // DEVELOPER_ERROR ("10") = package name / SHA-1 not registered on the
        // Android OAuth client, or webClientId missing from this build.
        setGoogleError(
          `Google sign-in failed (code ${String(err.code)}). Web client in this build: ${webClientHint}`,
        );
      } else {
        setGoogleError('Google sign-in failed. Please try again.');
      }
    } finally {
      setGoogleBusy(false);
    }
  };

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
      // SEC-10: dev-only, and only the error code/message — never the whole
      // error object (it can carry native stack frames).
      if (__DEV__ && err.code !== 'ERR_REQUEST_CANCELED') {
        console.warn('[auth] Apple sign-in failed', err.code ?? err.message ?? 'unknown');
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* Navy hero: the app-wide dark status bar would be invisible here. */}
      <FocusedStatusBar style="light" />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 60 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroBox, { paddingTop: 30 + insets.top }]}>
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

          {authError || googleError ? (
            <Text style={styles.authErrorText}>{authError ?? googleError}</Text>
          ) : null}

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
              disabled={googleBusy || isAuthenticating}
              onPress={handleGoogle}
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

      <View style={[styles.termsFooter, { bottom: 16 + insets.bottom }]}>
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