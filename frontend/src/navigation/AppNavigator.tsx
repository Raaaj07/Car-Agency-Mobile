import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';

import { OnboardingNavigator } from './OnboardingNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { AdminNavigator } from './AdminNavigator';

import { CancelRideConfirmationScreen } from '../screens/shared/CancelRideConfirmationScreen';
import { RideCancelledScreen } from '../screens/shared/RideCancelledScreen';
import { RideAnnouncementsSettingsScreen } from '../screens/shared/RideAnnouncementsSettingsScreen';
import { BecomeDriverScreen } from '../screens/driver/BecomeDriverScreen';
import { CompleteProfileScreen } from '../screens/onboarding/CompleteProfileScreen';
import { useAuthStore } from '../store/authStore';
import { useRideStore } from '../store/rideStore';
import { ridesApi } from '../api/rides';
import { authApi } from '../api/auth';
import { getApiError, getApiStatus } from '../api/client';
import { colors } from '../theme/theme';
import { Button } from '../components/primitives/Button';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useAuthStore((state) => state.hydrated);
  const bootOffline = useAuthStore((state) => state.bootOffline);
  const user = useAuthStore((state) => state.user);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [completing, setCompleting] = useState(false);
  const [profileError, setProfileError] = useState<string | undefined>();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Stored tokens exist but the server is unreachable: keep the tokens and
  // offer Retry instead of dropping to the login flow.
  if (bootOffline && !isAuthenticated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 32, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' }}>
          {`You're offline`}
        </Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>
          {`Couldn't reach the server. Check your connection and try again — you're still signed in on this device.`}
        </Text>
        <Button title="Retry" onPress={() => restoreSession()} />
      </View>
    );
  }

  const needsProfile = isAuthenticated && user && user.profileComplete === false;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        ) : needsProfile ? (
          <Stack.Screen name="CompleteProfile">
            {() => (
              <CompleteProfileScreen
                isSubmitting={completing}
                serverError={profileError}
                onSubmit={async (name) => {
                  setCompleting(true);
                  setProfileError(undefined);
                  try {
                    const updated = await authApi.updateMe({ name });
                    useAuthStore.getState().updateUser(updated);
                  } catch (error) {
                    setProfileError(getApiError(error));
                  } finally {
                    setCompleting(false);
                  }
                }}
              />
            )}
          </Stack.Screen>
        ) : (
          <>
            {/* Admins get the review console; everyone else gets the unified app. */}
            {user?.role === 'admin' ? (
              <Stack.Screen name="Admin" component={AdminNavigator} />
            ) : (
              <Stack.Screen name="Main" component={MainTabNavigator} />
            )}

            <Stack.Screen name="BecomeDriver">
              {({ navigation }) => (
                <BecomeDriverScreen onBack={() => navigation.goBack()} onDone={() => navigation.goBack()} />
              )}
            </Stack.Screen>

            <Stack.Group screenOptions={{ presentation: 'modal', animation: 'slide_from_bottom' }}>
              <Stack.Screen name="CancelRideConfirmation">
                {({ navigation }) => (
                  <CancelRideConfirmationScreen
                    onBack={() => navigation.goBack()}
                    onConfirmCancel={async (reason) => {
                      try {
                        let ride = useRideStore.getState().activeRide;
                        if (!ride) {
                          const restored = await ridesApi.getActive().catch(() => null);
                          if (restored) {
                            useRideStore.getState().setActiveRide(restored as any);
                            if (restored.pickup) {
                              useRideStore.getState().setPickup(restored.pickup.address, restored.pickup.address, { lat: restored.pickup.lat, lng: restored.pickup.lng });
                            }
                            if (restored.dropoff) {
                              useRideStore.getState().setDropoff(restored.dropoff.address, restored.dropoff.address, { lat: restored.dropoff.lat, lng: restored.dropoff.lng });
                            }
                            ride = useRideStore.getState().activeRide;
                          }
                        }
                        if (!ride) {
                          Alert.alert('No active ride found', 'There is no active ride to cancel.');
                          navigation.goBack();
                          return;
                        }
                        await ridesApi.cancel(ride.id, reason);
                        useRideStore.getState().setCancellationReason(reason);
                        useRideStore.getState().resetRide();
                        navigation.navigate('RideCancelled', { reason });
                      } catch (error) {
                        // SEC-3: a mid-trip cancel is refused with 409 — say what
                        // to do instead (ask the driver / support) and keep the
                        // active ride intact so the trip view stays usable.
                        if (getApiStatus(error) === 409) {
                          Alert.alert('Cannot cancel now', getApiError(error));
                        } else {
                          Alert.alert('Cancellation failed', getApiError(error));
                        }
                      }
                    }}
                  />
                )}
              </Stack.Screen>

              <Stack.Screen name="RideCancelled">
                {({ navigation, route }) => (
                  <RideCancelledScreen
                    reason={route.params?.reason}
                    onBookNew={() => {
                      useRideStore.getState().resetRide();
                      navigation.navigate('Main', { screen: 'HomeTab' } as any);
                    }}
                    onGoHome={() => {
                      useRideStore.getState().resetRide();
                      navigation.navigate('Main', { screen: 'HomeTab' } as any);
                    }}
                  />
                )}
              </Stack.Screen>

              <Stack.Screen name="RideAnnouncementsSettings">
                {({ navigation }) => (
                  <RideAnnouncementsSettingsScreen
                    onBack={() => navigation.goBack()}
                    onSave={() => navigation.goBack()}
                  />
                )}
              </Stack.Screen>
            </Stack.Group>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
