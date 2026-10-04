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
import { getApiError } from '../api/client';
import { applyRideToStore, beginBooking, endBooking, screenForStatus } from '../hooks/useActiveRide';

const Stack = createNativeStackNavigator<RiderHomeStackParamList>();

type RootNavProp = NativeStackNavigationProp<RootStackParamList>;

export const RiderHomeStackNavigator: React.FC = () => {
  const rootNavigation = useNavigation<RootNavProp>();
  const setDropoff = useRideStore((state) => state.setDropoff);
  const setSelectedVehicle = useRideStore((state) => state.setSelectedVehicle);
  const resetRide = useRideStore((state) => state.resetRide);
  const setActiveRide = useRideStore((state) => state.setActiveRide);
  const setMatchResult = useRideStore((state) => state.setMatchResult);

  return (
    <Stack.Navigator
      initialRouteName="HomeDashboard"
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="HomeDashboard">
        {({ navigation }) => (
          <HomeDashboardScreen
            onSearchPress={(focus) => navigation.navigate('DestinationSearch', { focus })}
            onSelectVehicle={() => navigation.navigate('VehicleSelection')}
            onBellPress={() => rootNavigation.navigate('RideAnnouncementsSettings')}
            onExploreServices={() => (navigation.getParent() as any)?.navigate('ServicesTab')}
          />
        )}
      </Stack.Screen>

        <Stack.Screen name="DestinationSearch">
        {({ navigation, route }) => (
              <DestinationSearchScreen
                onBack={() => navigation.goBack()}
                focus={route.params?.focus}
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
              const bookingInput = {
                pickup: { address: state.pickupAddress, lat: state.pickupCoords.lat, lng: state.pickupCoords.lng },
                dropoff: { address: state.dropoffAddress, lat: state.dropoffCoords.lat, lng: state.dropoffCoords.lng },
                vehicleType: state.selectedVehicle.id,
                promoCode: state.promoCode,
                paymentMethod: 'upi' as const,
                // Allow larger vehicle to accept (auto->mini->sedan->suv) so a
                // sedan request can still match an SUV driver when no sedan
                // is nearby. Backend defaults this to false.
                allowUpgrade: true,
              };
              const bookOnce = async () => {
                beginBooking();
                try {
                  const ride = await ridesApi.create(bookingInput);
                  setActiveRide(ride);
                  // R-1: remember whether the search came back empty so
                  // FindingDriver can show the honest "no drivers" state.
                  setMatchResult(ride.match?.status ?? null);
                  navigation.navigate('FindingDriver');
                } finally {
                  // Keep the flag up for the whole booking attempt so a
                  // concurrent restoreActiveRide() cannot clear the new ride.
                  endBooking();
                }
              };
              try {
                await bookOnce();
              } catch (error) {
                const message = getApiError(error);
                if (!message.toLowerCase().includes('active ride')) {
                  Alert.alert('Booking failed', message);
                  return;
                }
                Alert.alert(
                  'You already have an active ride',
                  'Resume it or cancel it before booking a new one.',
                  [
                    {
                      text: 'Resume',
                      onPress: async () => {
                        try {
                          const active = await ridesApi.getActive();
                          if (!active) {
                            // Race: the old ride just ended — retry once.
                            await bookOnce();
                            return;
                          }
                          applyRideToStore(active);
                          navigation.navigate(screenForStatus(active.status));
                        } catch (err) {
                          Alert.alert('Booking failed', getApiError(err));
                        }
                      },
                    },
                    {
                      text: 'Cancel ride',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          const active = await ridesApi.getActive();
                          if (!active) {
                            // Race: the old ride just ended — retry once.
                            await bookOnce();
                            return;
                          }
                          applyRideToStore(active);
                          rootNavigation.navigate('CancelRideConfirmation');
                        } catch (err) {
                          Alert.alert('Booking failed', getApiError(err));
                        }
                      },
                    },
                    { text: 'Close', style: 'cancel' },
                  ],
                );
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
            onRideCancelled={(reason) => {
              // Cancelled by the driver or the stale sweep while this screen
              // was open — mirror FindingDriver: land on the outcome screen.
              resetRide();
              rootNavigation.navigate('RideCancelled', { reason });
            }}
            onRideCompleted={() => navigation.navigate('ReviewRide')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="TripProgress">
        {({ navigation }) => (
          <TripProgressScreen
            onCompleteTrip={() => navigation.navigate('ReviewRide')}
            onCancelRide={() => rootNavigation.navigate('CancelRideConfirmation')}
            onRideCancelled={(reason) => {
              resetRide();
              rootNavigation.navigate('RideCancelled', { reason });
            }}
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
                // No silent auto-payment here: the rider pays the UPI QR on
                // the driver's phone and the driver taps "Amount Received",
                // which flips paymentStatus — PaymentFareBreakdown polls it.
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
