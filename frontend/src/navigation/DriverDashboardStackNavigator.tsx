import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DriverDashboardStackParamList } from './types';

import { DriverDashboardScreen } from '../screens/driver/DriverDashboardScreen';
import { RideRequestNearbyScreen } from '../screens/driver/RideRequestNearbyScreen';
import { TurnByTurnNavigationScreen } from '../screens/driver/TurnByTurnNavigationScreen';
import { RideAvailableAgainScreen } from '../screens/driver/RideAvailableAgainScreen';
import { Alert } from 'react-native';
import { ridesApi } from '../api/rides';
import { useRideStore } from '../store/rideStore';
import { getApiError } from '../api/client';
import { DriverOtpEntryScreen } from '../screens/driver/DriverOtpEntryScreen';
import { useState } from 'react';

const Stack = createNativeStackNavigator<DriverDashboardStackParamList>();

export const DriverDashboardStackNavigator: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
const [otpError, setOtpError] = useState<string | undefined>();
  return (
    <Stack.Navigator
      initialRouteName="DriverDashboard"
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="DriverDashboard">
        {({ navigation }) => (
          <DriverDashboardScreen
            onSimulateRequest={() => navigation.navigate('RideRequestNearby')}
            onRideRequest={() => navigation.navigate('RideRequestNearby')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideRequestNearby">
        {({ navigation }) => (
          <RideRequestNearbyScreen
            onAccept={async () => {
              const ride = useRideStore.getState().activeRide;
              if (!ride) return Alert.alert('Ride unavailable', 'This ride request is no longer available.');
              try {
                const accepted = await ridesApi.accept(ride.id);
                const enRoute = await ridesApi.enRoute(ride.id);
                useRideStore.getState().setActiveRide(enRoute ?? accepted);
                 navigation.navigate('TurnByTurnNavigation', { phase: 'to_pickup' });
              } catch (error) {
                Alert.alert('Unable to accept ride', getApiError(error));
                navigation.goBack();
              }
            }}
            onDecline={async () => {
              const ride = useRideStore.getState().activeRide;
              try { if (ride) await ridesApi.decline(ride.id); }
              catch (error) { Alert.alert('Unable to decline ride', getApiError(error)); }
              navigation.goBack();
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="TurnByTurnNavigation">
  {({ navigation, route }) => (
    <TurnByTurnNavigationScreen
      phase={route.params?.phase ?? 'to_pickup'}
      isSubmitting={isSubmitting}
      onPrimaryAction={async () => {
        const ride = useRideStore.getState().activeRide;
        if (!ride) return;
        setIsSubmitting(true);
        try {
          if ((route.params?.phase ?? 'to_pickup') === 'to_pickup') {
            const { ride: started } = await ridesApi.start(ride.id);
            useRideStore.getState().setActiveRide(started);
            navigation.navigate('DriverOtpEntry');
          } else {
            const completed = await ridesApi.complete(ride.id);
            useRideStore.getState().setActiveRide(completed);
            navigation.navigate('RideAvailableAgain');
          }
        } catch (error) {
          Alert.alert(
            (route.params?.phase ?? 'to_pickup') === 'to_pickup' ? 'Unable to start trip' : 'Unable to complete trip',
            getApiError(error),
          );
        } finally {
          setIsSubmitting(false);
        }
      }}
    />
  )}
</Stack.Screen>


<Stack.Screen name="DriverOtpEntry">
  {({ navigation }) => (
    <DriverOtpEntryScreen
      onBack={() => navigation.goBack()}
      isVerifying={isSubmitting}
      serverError={otpError}
      onVerify={async (otp) => {
        const ride = useRideStore.getState().activeRide;
        if (!ride) return;
        setIsSubmitting(true);
        setOtpError(undefined);
        try {
          const inProgress = await ridesApi.verifyPickupOtp(ride.id, otp);
          useRideStore.getState().setActiveRide(inProgress);
          navigation.navigate('TurnByTurnNavigation', { phase: 'in_progress' });
        } catch (error) {
          setOtpError(getApiError(error));
        } finally {
          setIsSubmitting(false);
        }
      }}
    />
  )}
</Stack.Screen>

<Stack.Screen name="RideAvailableAgain">
  {({ navigation }) => (
    <RideAvailableAgainScreen onBackToDashboard={() => navigation.navigate('DriverDashboard')} />
  )}
</Stack.Screen>
    </Stack.Navigator>
  );
};
