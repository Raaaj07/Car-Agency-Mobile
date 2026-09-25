import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DriverDashboardStackParamList } from './types';

import { DriverDashboardScreen } from '../screens/driver/DriverDashboardScreen';
import { RideRequestNearbyScreen } from '../screens/driver/RideRequestNearbyScreen';
import { TurnByTurnNavigationScreen } from '../screens/driver/TurnByTurnNavigationScreen';
import { RideAvailableAgainScreen } from '../screens/driver/RideAvailableAgainScreen';

const Stack = createNativeStackNavigator<DriverDashboardStackParamList>();

export const DriverDashboardStackNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="DriverDashboard"
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="DriverDashboard">
        {({ navigation }) => (
          <DriverDashboardScreen
            onSimulateRequest={() => navigation.navigate('RideRequestNearby')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideRequestNearby">
        {({ navigation }) => (
          <RideRequestNearbyScreen
            onAccept={() => navigation.navigate('TurnByTurnNavigation')}
            onDecline={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="TurnByTurnNavigation">
        {({ navigation }) => (
          <TurnByTurnNavigationScreen
            onArrived={() => navigation.navigate('RideAvailableAgain')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideAvailableAgain">
        {({ navigation }) => (
          <RideAvailableAgainScreen
            onBackToDashboard={() => navigation.navigate('DriverDashboard')}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};
