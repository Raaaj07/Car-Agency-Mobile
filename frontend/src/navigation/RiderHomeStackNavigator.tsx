import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RiderHomeStackParamList, RootStackParamList } from './types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

import { HomeDashboardScreen } from '../screens/rider/HomeDashboardScreen';
import { DestinationSearchScreen } from '../screens/rider/DestinationSearchScreen';
import { VehicleSelectionScreen } from '../screens/rider/VehicleSelectionScreen';
import { RideDetailsScreen } from '../screens/rider/RideDetailsScreen';
import { FindingDriverScreen } from '../screens/rider/FindingDriverScreen';
import { YouGotTheRideScreen } from '../screens/rider/YouGotTheRideScreen';
import { DriverEnRouteScreen } from '../screens/rider/DriverEnRouteScreen';
import { TripProgressScreen } from '../screens/rider/TripProgressScreen';
import { ReviewRideScreen } from '../screens/rider/ReviewRideScreen';
import { PaymentFareBreakdownScreen } from '../screens/rider/PaymentFareBreakdownScreen';
import { RideCompletedScreen } from '../screens/rider/RideCompletedScreen';
import { useRideStore } from '../store/rideStore';

const Stack = createNativeStackNavigator<RiderHomeStackParamList>();

type RootNavProp = NativeStackNavigationProp<RootStackParamList>;

export const RiderHomeStackNavigator: React.FC = () => {
  const rootNavigation = useNavigation<RootNavProp>();
  const setDropoff = useRideStore((state) => state.setDropoff);
  const setSelectedVehicle = useRideStore((state) => state.setSelectedVehicle);
  const resetRide = useRideStore((state) => state.resetRide);

  return (
    <Stack.Navigator
      initialRouteName="HomeDashboard"
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="HomeDashboard">
        {({ navigation }) => (
          <HomeDashboardScreen
            onSearchPress={() => navigation.navigate('DestinationSearch')}
            onSelectVehicle={() => navigation.navigate('VehicleSelection')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="DestinationSearch">
        {({ navigation }) => (
          <DestinationSearchScreen
            onBack={() => navigation.goBack()}
            onSelectDestination={(place) => {
              setDropoff(place.title, place.subtitle);
              navigation.navigate('VehicleSelection');
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="VehicleSelection">
        {({ navigation }) => (
          <VehicleSelectionScreen
            onBack={() => navigation.goBack()}
            onConfirmVehicle={(vehicle) => {
              setSelectedVehicle(vehicle);
              navigation.navigate('RideDetails');
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideDetails">
        {({ navigation }) => (
          <RideDetailsScreen
            onBack={() => navigation.goBack()}
            onConfirmRide={() => navigation.navigate('FindingDriver')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="FindingDriver">
        {({ navigation }) => (
          <FindingDriverScreen
            onDriverFound={() => navigation.navigate('YouGotTheRide')}
            onCancel={() => rootNavigation.navigate('CancelRideConfirmation')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="YouGotTheRide">
        {({ navigation }) => (
          <YouGotTheRideScreen onTrackDriver={() => navigation.navigate('DriverEnRoute')} />
        )}
      </Stack.Screen>

      <Stack.Screen name="DriverEnRoute">
        {({ navigation }) => (
          <DriverEnRouteScreen
            onStartTrip={() => navigation.navigate('TripProgress')}
            onCancelRide={() => rootNavigation.navigate('CancelRideConfirmation')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="TripProgress">
        {({ navigation }) => (
          <TripProgressScreen
            onCompleteTrip={() => navigation.navigate('ReviewRide')}
            onEmergencyPress={() => rootNavigation.navigate('RideAnnouncementsSettings')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="ReviewRide">
        {({ navigation }) => (
          <ReviewRideScreen
            onBack={() => navigation.goBack()}
            onSubmitReview={() => navigation.navigate('PaymentFareBreakdown')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="PaymentFareBreakdown">
        {({ navigation }) => (
          <PaymentFareBreakdownScreen
            onBack={() => navigation.goBack()}
            onDone={() => navigation.navigate('RideCompleted')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideCompleted">
        {({ navigation }) => (
          <RideCompletedScreen
            onGoHome={() => {
              resetRide();
              navigation.navigate('HomeDashboard');
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};
