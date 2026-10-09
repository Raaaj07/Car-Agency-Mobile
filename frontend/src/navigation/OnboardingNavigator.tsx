import React, { useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from './types';

import { LanguageSelectionScreen } from '../screens/onboarding/LanguageSelectionScreen';
import { SignInScreen } from '../screens/onboarding/SignInScreen';
import { MobileNumberScreen } from '../screens/onboarding/MobileNumberScreen';
import { OTPVerificationScreen } from '../screens/onboarding/OTPVerificationScreen';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';
import { getApiError } from '../api/client';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

// Sign-in only. Profile completion is gated by the server flag in
// AppNavigator (authenticated && !profileComplete → CompleteProfile screen),
// never by navigating inside this stack (that screen unmounted instantly).
export const OnboardingNavigator: React.FC = () => {
  const setLanguage = useAuthStore((state) => state.setLanguage);
  const setPhone = useAuthStore((state) => state.setPhone);
  const login = useAuthStore((state) => state.login);
  const developmentOtp = useAuthStore((s) => s.developmentOtp);
  const otpLength = useAuthStore((s) => s.otpLength);
  const [socialAuthError, setSocialAuthError] = useState<string | undefined>();

  return (
    <Stack.Navigator
      initialRouteName="LanguageSelection"
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="LanguageSelection">
        {({ navigation }) => (
          <LanguageSelectionScreen
            onNext={() => {
              setLanguage('en');
              navigation.navigate('SignIn');
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="SignIn">
        {({ navigation }) => (
          <SignInScreen
            onMobileSignIn={() => navigation.navigate('MobileNumber')}
            authError={socialAuthError}
            onGoogleToken={async (idToken) => {
              setSocialAuthError(undefined);
              try {
                const result = await authApi.googleSignIn(idToken);
                login(result.user, result);
              } catch (error) {
                setSocialAuthError(getApiError(error));
              }
            }}
            onAppleToken={async (identityToken, fullName) => {
              setSocialAuthError(undefined);
              try {
                const result = await authApi.appleSignIn(identityToken, fullName);
                login(result.user, result);
              } catch (error) {
                setSocialAuthError(getApiError(error));
              }
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="MobileNumber">
        {({ navigation }) => (
          <MobileNumberScreen
            onBack={() => navigation.goBack()}
            onSendOTP={async (phone) => {
              try {
                const response = await authApi.sendOtp(phone);
                useAuthStore.getState().setDevelopmentOtp(response.devOtp ?? null);
                // SEC-1: absent on old servers → keep the 4-box default.
                useAuthStore.getState().setOtpLength(response.otpLength ?? 4);
              } catch (error) {
                throw new Error(getApiError(error));
              }
              setPhone(phone);
              navigation.navigate('OTPVerification');
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="OTPVerification">
        {({ navigation }) => (
          <OTPVerificationScreen
            onBack={() => navigation.goBack()}
            phone={useAuthStore.getState().phone}
            developmentOtp={developmentOtp}
            length={otpLength}
            // Returns the (possibly updated) width so the screen can resize
            // its boxes right after a resend, not one render later.
            onResend={async () => {
              try {
                const response = await authApi.sendOtp(useAuthStore.getState().phone);
                useAuthStore.getState().setDevelopmentOtp(response.devOtp ?? null);
                const nextLength = response.otpLength ?? 4;
                useAuthStore.getState().setOtpLength(nextLength);
                return nextLength;
              } catch (error) {
                throw new Error(getApiError(error));
              }
            }}
            onVerify={async (otp) => {
              try {
                const state = useAuthStore.getState();
                const result = await authApi.verifyOtp({ phone: state.phone, otp });
                // No navigation here: AppNavigator re-renders from
                // isAuthenticated/profileComplete automatically.
                login(result.user, result);
              } catch (error) {
                throw new Error(getApiError(error));
              }
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};
