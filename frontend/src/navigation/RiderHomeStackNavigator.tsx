import React from 'react';
import { Alert } from 'react-native';
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
import { ridesApi } from '../api/rides';
import { paymentsApi } from '../api/payments';
import { getApiError } from '../api/client';

const Stack = createNativeStackNavigator<RiderHomeStackParamList>();

type RootNavProp = NativeStackNavigationProp<RootStackParamList>;

export const RiderHomeStackNavigator: React.FC = () => {
  const rootNavigation = useNavigation<RootNavProp>();
  const setDropoff = useRideStore((state) => state.setDropoff);
  const setSelectedVehicle = useRideStore((state) => state.setSelectedVehicle);
  const resetRide = useRideStore((state) => state.resetRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);

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
                onSelectDestination={() => {
                  // setPickup/setDropoff already happened inside DestinationSearchScreen
                  // (it needs the store to know which field — pickup or dropoff —
                  // was being edited when a suggestion was tapped).
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
              onConfirmRide={async () => {
                const state = useRideStore.getState();
              if (!state.pickupCoords || !state.dropoffCoords) {
                Alert.alert('Missing location', 'Please pick a pickup and drop-off location first.');
                return;
              }
              try {
                const ride = await ridesApi.create({
                  pickup: { address: state.pickupAddress, lat: state.pickupCoords.lat, lng: state.pickupCoords.lng },
                  dropoff: { address: state.dropoffAddress, lat: state.dropoffCoords.lat, lng: state.dropoffCoords.lng },
                  vehicleType: state.selectedVehicle.id,
                  promoCode: state.promoCode,
                  paymentMethod: 'upi',
                });
                setActiveRide(ride);
                navigation.navigate('FindingDriver');
              } catch (error) {
                Alert.alert('Booking failed', getApiError(error));
              }
            }}
          />
        )}
      </Stack.Screen>

            <Stack.Screen name="FindingDriver">
        {({ navigation }) => (
          <FindingDriverScreen
            onDriverFound={() => navigation.navigate('YouGotTheRide')}
            onCancelPress={() => rootNavigation.navigate('CancelRideConfirmation')}
            onRideCancelled={() => {
              // The ride is already cancelled by the time this fires — go
              // straight to the outcome screen instead of re-prompting for
              // confirmation (that re-prompt was the double-modal bug).
              const ride = useRideStore.getState().activeRide;
              rootNavigation.navigate('RideCancelled', {
                reason: ride?.cancellationReason ?? undefined,
              });
            }}
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
            onSubmitReview={async (rating, compliments, tipAmount) => {
              const ride = useRideStore.getState().activeRide;
              if (!ride) return Alert.alert('Ride unavailable', 'No active ride was found.');
              try {
                const updated = await ridesApi.review(ride.id, { rating, compliments, tipAmount });
                setActiveRide(updated);
                const order = await paymentsApi.createOrder(updated.id, 'upi');
                await paymentsApi.verify(updated.id, order.orderId);
                setActiveRide({ ...updated, paymentStatus: 'paid' });
                navigation.navigate('PaymentFareBreakdown');
              } catch (error) {
                Alert.alert('Unable to submit review', getApiError(error));
              }
            }}
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
