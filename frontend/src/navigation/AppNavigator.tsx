import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';

import { OnboardingNavigator } from './OnboardingNavigator';
import { RiderTabNavigator } from './RiderTabNavigator';
import { DriverTabNavigator } from './DriverTabNavigator';

import { CancelRideConfirmationScreen } from '../screens/shared/CancelRideConfirmationScreen';
import { RideCancelledScreen } from '../screens/shared/RideCancelledScreen';
import { RideAnnouncementsSettingsScreen } from '../screens/shared/RideAnnouncementsSettingsScreen';
import { useAuthStore } from '../store/authStore';
import { useRideStore } from '../store/rideStore';
import { ridesApi } from '../api/rides';
import { getApiError } from '../api/client';
import { Alert } from 'react-native';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.role);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        ) : (
          <>
            {/* Only the main screen for this account's role exists in the
                tree, so a driver can never land on the rider dashboard.
                (role is set on RoleSelection, long before login.) */}
            {role === 'driver' ? (
              <Stack.Screen name="DriverMain" component={DriverTabNavigator} />
            ) : (
              <Stack.Screen name="RiderMain" component={RiderTabNavigator} />
            )}

            <Stack.Group screenOptions={{ presentation: 'modal', animation: 'slide_from_bottom' }}>
              <Stack.Screen name="CancelRideConfirmation">
                {({ navigation }) => (
                  <CancelRideConfirmationScreen
                    onBack={() => navigation.goBack()}
                    onConfirmCancel={async (reason) => {
                      try {
                        const ride = useRideStore.getState().activeRide;
                        if (ride) await ridesApi.cancel(ride.id, reason);
                        useRideStore.getState().setCancellationReason(reason);
                        navigation.navigate('RideCancelled', { reason });
                      } catch (error) {
                        Alert.alert('Cancellation failed', getApiError(error));
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
                      navigation.navigate('RiderMain', {
                        screen: 'HomeTab',
                        params: { screen: 'HomeDashboard' },
                      });
                    }}
                    onGoHome={() => {
                      useRideStore.getState().resetRide();
                      navigation.navigate('RiderMain', {
                        screen: 'HomeTab',
                        params: { screen: 'HomeDashboard' },
                      });
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