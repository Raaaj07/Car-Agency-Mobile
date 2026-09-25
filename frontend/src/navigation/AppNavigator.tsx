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
import { useRideStore } from '../store/rideStore';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Onboarding"
        screenOptions={{ headerShown: false }}
      >
        {/* Core Main Flow Stacks */}
        <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        <Stack.Screen name="RiderMain" component={RiderTabNavigator} />
        <Stack.Screen name="DriverMain" component={DriverTabNavigator} />

        {/* Shared Presentation Modals */}
        <Stack.Group screenOptions={{ presentation: 'modal', animation: 'slide_from_bottom' }}>
          <Stack.Screen name="CancelRideConfirmation">
            {({ navigation }) => (
              <CancelRideConfirmationScreen
                onBack={() => navigation.goBack()}
                onConfirmCancel={(reason) => {
                  useRideStore.getState().setCancellationReason(reason);
                  navigation.navigate('RideCancelled', { reason });
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
      </Stack.Navigator>
    </NavigationContainer>
  );
};
