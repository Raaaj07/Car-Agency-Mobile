import React, { useState } from 'react';
import { Alert } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingStackParamList, RootStackParamList } from './types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

import { LanguageSelectionScreen } from '../screens/onboarding/LanguageSelectionScreen';
import { RoleSelectionScreen } from '../screens/onboarding/RoleSelectionScreen';
import { SignInScreen } from '../screens/onboarding/SignInScreen';
import { MobileNumberScreen } from '../screens/onboarding/MobileNumberScreen';
import { OTPVerificationScreen } from '../screens/onboarding/OTPVerificationScreen';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';
import { driversApi } from '../api/drivers';
import { getApiError } from '../api/client';
import { CompleteProfileScreen } from '../screens/onboarding/CompleteProfileScreen';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

type RootNavProp = NativeStackNavigationProp<RootStackParamList>;

export const OnboardingNavigator: React.FC = () => {
  const rootNavigation = useNavigation<RootNavProp>();
  const setLanguage = useAuthStore((state) => state.setLanguage);
  const setRole = useAuthStore((state) => state.setRole);
  const setPhone = useAuthStore((state) => state.setPhone);
  const login = useAuthStore((state) => state.login);
  const developmentOtp = useAuthStore((s) => s.developmentOtp);
  const role = useAuthStore((s) => s.role);
  const [socialAuthError, setSocialAuthError] = useState<string | undefined>();
  const [isCompletingProfile, setIsCompletingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | undefined>();

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
              navigation.navigate('RoleSelection');
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RoleSelection">
        {({ navigation }) => (
          <RoleSelectionScreen
            onNext={(selectedRole) => {
              setRole(selectedRole);
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
              const currentRole = useAuthStore.getState().role;
              if (!currentRole) {
                setSocialAuthError('Please choose a role first');
                return;
              }
              try {
                const result = await authApi.googleSignIn(idToken, currentRole);
                login(result.user, result);
                rootNavigation.reset({
                  index: 0,
                  routes: [{ name: currentRole === 'driver' ? 'DriverMain' : 'RiderMain' }],
                });
              } catch (error) {
                console.log('Google sign-in failed:', error);
                setSocialAuthError(getApiError(error));
              }
            }}
            onAppleToken={async (identityToken, fullName) => {
              setSocialAuthError(undefined);
              const currentRole = useAuthStore.getState().role;
              if (!currentRole) {
                setSocialAuthError('Please choose a role first');
                return;
              }
              try {
                const result = await authApi.appleSignIn(identityToken, fullName, currentRole);
                login(result.user, result);
                rootNavigation.reset({
                  index: 0,
                  routes: [{ name: currentRole === 'driver' ? 'DriverMain' : 'RiderMain' }],
                });
              } catch (error) {
                console.log('Apple sign-in failed:', error);
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
            onResend={async () => {
              try {
                const response = await authApi.sendOtp(useAuthStore.getState().phone);
                useAuthStore.getState().setDevelopmentOtp(response.devOtp ?? null);
              } catch (error) {
                throw new Error(getApiError(error));
              }
            }}
            onVerify={async (otp) => {
              try {
                const state = useAuthStore.getState();
                if (!state.role) throw new Error('Please choose a role first');
                const result = await authApi.verifyOtp({ phone: state.phone, otp, role: state.role });
                login(result.user, result);

                // Every new signup — rider or driver — always goes through
                // CompleteProfile first, so we know their real name (and,
                // for drivers, their vehicle) before they ever reach the app.
                if (result.isNewUser) {
                  navigation.navigate('CompleteProfile');
                  return;
                }
              } catch (error) {
                throw new Error(getApiError(error));
              }
              const currentRole = useAuthStore.getState().role;
              if (currentRole === 'driver') {
                rootNavigation.reset({ index: 0, routes: [{ name: 'DriverMain' }] });
              } else {
                rootNavigation.reset({ index: 0, routes: [{ name: 'RiderMain' }] });
              }
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="CompleteProfile">
        {() => (
          <CompleteProfileScreen
            role={role}
            isSubmitting={isCompletingProfile}
            serverError={profileError}
            onSubmit={async (name, vehicle) => {
              setIsCompletingProfile(true);
              setProfileError(undefined);
              try {
                const updatedUser = await authApi.updateMe({ name });
                useAuthStore.getState().updateUser(updatedUser);

                const currentRole = useAuthStore.getState().role;
                if (currentRole === 'driver') {
                  if (!vehicle) {
                    throw new Error('Vehicle details are required to continue as a driver');
                  }
                  // Registers the vehicle/plate the backend requires before a
                  // driver can go online (DriverDashboardScreen assumes this exists).
                  await driversApi.register(vehicle);
                }

                rootNavigation.reset({
                  index: 0,
                  routes: [{ name: currentRole === 'driver' ? 'DriverMain' : 'RiderMain' }],
                });
              } catch (error) {
                setProfileError(getApiError(error));
              } finally {
                setIsCompletingProfile(false);
              }
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};