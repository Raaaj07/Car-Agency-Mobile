import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Text, Alert } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';

import { OnboardingNavigator } from './OnboardingNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { AdminNavigator } from './AdminNavigator';
import { flattenRouteNames, goToRideCancelled } from './navHelpers';

import { CancelRideConfirmationScreen } from '../screens/shared/CancelRideConfirmationScreen';
import { RideCancelledScreen } from '../screens/shared/RideCancelledScreen';
import { RideAnnouncementsSettingsScreen } from '../screens/shared/RideAnnouncementsSettingsScreen';
import { HelpSupportScreen } from '../screens/shared/HelpSupportScreen';
import { MyVehicleScreen } from '../screens/driver/MyVehicleScreen';
import { PaymentQrScreen } from '../screens/driver/PaymentQrScreen';
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
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
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

  // Push: register this device once the account is signed in and complete.
  const pushReady = isAuthenticated && user?.profileComplete !== false;
  useEffect(() => {
    if (!pushReady) return;
    void import('../lib/push').then(async (m) => {
      await m.configurePushHandler();
      await m.registerForPush();
    });
  }, [pushReady]);

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
    <NavigationContainer
      ref={navigationRef}
      // Back-navigation audit evidence: prints the focused route chain on
      // every state change, e.g. "[nav] Main > HomeTab > DestinationSearch".
      onStateChange={() => {
        if (!__DEV__) return;
        const names = flattenRouteNames(navigationRef.current?.getRootState());
        if (names.length > 0) console.log(`[nav] ${names.join(' > ')}`);
      }}
    >
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
                        // D4: replace the whole root state — [fresh Main
                        // (HomeTab > HomeDashboard), RideCancelled] — instead
                        // of pushing RideCancelled over this modal and then
                        // stacking a second Main on top of it.
                        goToRideCancelled(navigation, { reason });
                      } catch (error) {
                        // SEC-3: a mid-trip cancel is refused with 409 — say what
                        // to do instead (ask the driver / support) and keep the
                        // active ride intact so the trip view stays usable.
                        if (getApiStatus(error) === 409) {
                          // R-5: refresh from the server so the trip view shows
                          // reality after the refusal (and any transition that
                          // happened meanwhile). The alert is awaited LAST so the
                          // user always sees it — never a stuck spinner.
                          const fresh = await ridesApi.getActive().catch(() => null);
                          if (fresh) {
                            useRideStore.getState().setActiveRide(fresh as any);
                          }
                          Alert.alert('Cannot cancel now', getApiError(error));
                        } else {
                          Alert.alert('Cancellation failed', getApiError(error));
                        }
                      }
                    }}
                  />
                )}
              </Stack.Screen>

              <Stack.Screen
                name="RideCancelled"
                // D4: no swipe-back into the (now fresh) stack below — the
                // outcome screen is a dead end: back and both buttons go Home.
                options={{ gestureEnabled: false }}
              >
                {({ navigation, route }) => (
                  <RideCancelledScreen
                    reason={route.params?.reason}
                    onBookNew={() => {
                      useRideStore.getState().resetRide();
                      // Pop back to the Main that goToRideCancelled placed
                      // underneath us — it is already HomeTab > HomeDashboard.
                      navigation.popTo('Main');
                    }}
                    onGoHome={() => {
                      useRideStore.getState().resetRide();
                      navigation.popTo('Main');
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

              {/* Profile-page destinations (rider + driver share these). */}
              <Stack.Screen name="HelpSupport">
                {({ navigation }) => <HelpSupportScreen onBack={() => navigation.goBack()} />}
              </Stack.Screen>
              <Stack.Screen name="MyVehicle">
                {({ navigation }) => <MyVehicleScreen onBack={() => navigation.goBack()} />}
              </Stack.Screen>
              <Stack.Screen name="PaymentQr">
                {({ navigation }) => <PaymentQrScreen onBack={() => navigation.goBack()} />}
              </Stack.Screen>
            </Stack.Group>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
