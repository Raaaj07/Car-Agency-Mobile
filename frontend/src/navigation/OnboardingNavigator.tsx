import React from 'react';
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

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

type RootNavProp = NativeStackNavigationProp<RootStackParamList>;

export const OnboardingNavigator: React.FC = () => {
  const rootNavigation = useNavigation<RootNavProp>();
  const setLanguage = useAuthStore((state) => state.setLanguage);
  const setRole = useAuthStore((state) => state.setRole);
  const setPhone = useAuthStore((state) => state.setPhone);
  const login = useAuthStore((state) => state.login);
  const role = useAuthStore((state) => state.role);

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
            onSocialSignIn={() => navigation.navigate('MobileNumber')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="MobileNumber">
        {({ navigation }) => (
          <MobileNumberScreen
            onBack={() => navigation.goBack()}
            onSendOTP={(phone) => {
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
            onVerify={() => {
              login();
              const currentRole = useAuthStore.getState().role;
              if (currentRole === 'driver') {
                rootNavigation.reset({
                  index: 0,
                  routes: [{ name: 'DriverMain' }],
                });
              } else {
                rootNavigation.reset({
                  index: 0,
                  routes: [{ name: 'RiderMain' }],
                });
              }
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};
