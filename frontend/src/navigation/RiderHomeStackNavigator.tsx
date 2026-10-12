import React from 'react';
import { Alert } from 'react-native';
import { createNativeStackNavigator, NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { MainTabParamList, RiderHomeStackParamList, RootStackParamList } from './types';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { goToRideCancelled, resetRiderHomeStack } from './navHelpers';

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
        {/* Annotated explicitly: this native-stack version doesn't contextually
            type the render-prop navigation (it falls back to `any`). */}
        {({ navigation }: NativeStackScreenProps<RiderHomeStackParamList, 'HomeDashboard'>) => (
          <HomeDashboardScreen
            onSearchPress={(focus) => navigation.navigate('DestinationSearch', { focus })}
            onSelectVehicle={() => navigation.navigate('VehicleSelection')}
            onBellPress={() => rootNavigation.navigate('RideAnnouncementsSettings')}
            onExploreServices={() => navigation.getParent<BottomTabNavigationProp<MainTabParamList>>()?.navigate('ServicesTab')}
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
                  // D2: entering the search resets the stack to
                  // [HomeDashboard, FindingDriver] so back can never walk
                  // into the booking form while a ride is being matched.
                  navigation.dispatch(
                    CommonActions.reset({
                      index: 1,
                      routes: [{ name: 'HomeDashboard' }, { name: 'FindingDriver' }],
                    }),
                  );
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
                          // D8: resume into a clean stack — never on top of
                          // whatever booking screens are still open.
                          resetRiderHomeStack(navigation, [screenForStatus(active.status)]);
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
            onDriverFound={() => navigation.replace('YouGotTheRide')}
            onCancelPress={() => rootNavigation.navigate('CancelRideConfirmation')}
            onRideCancelled={() => {
              // The ride is already cancelled by the time this fires — go
              // straight to the outcome screen instead of re-prompting for
              // confirmation (that re-prompt was the double-modal bug).
              const ride = useRideStore.getState().activeRide;
              goToRideCancelled(rootNavigation, {
                reason: ride?.cancellationReason ?? undefined,
              });
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="YouGotTheRide">
        {({ navigation }) => (
          <YouGotTheRideScreen
            onTrackDriver={() => navigation.replace('DriverEnRoute')}
            onRideCancelled={(reason) => {
              // Driver cancelled (or the system did) right after matching —
              // land on the outcome screen instead of a dead live map.
              resetRide();
              goToRideCancelled(rootNavigation, { reason });
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="DriverEnRoute">
        {({ navigation }) => (
          <DriverEnRouteScreen
            onStartTrip={() => navigation.replace('TripProgress')}
            onCancelRide={() => rootNavigation.navigate('CancelRideConfirmation')}
            onRideCancelled={(reason) => {
              // Cancelled by the driver or the stale sweep while this screen
              // was open — mirror FindingDriver: land on the outcome screen.
              resetRide();
              goToRideCancelled(rootNavigation, { reason });
            }}
            onRideCompleted={() => navigation.replace('ReviewRide')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="TripProgress">
        {({ navigation }) => (
          <TripProgressScreen
            onCompleteTrip={() => navigation.replace('ReviewRide')}
            onCancelRide={() => rootNavigation.navigate('CancelRideConfirmation')}
            onRideCancelled={(reason) => {
              resetRide();
              goToRideCancelled(rootNavigation, { reason });
            }}
            onEmergencyPress={() => rootNavigation.navigate('RideAnnouncementsSettings')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="ReviewRide">
        {({ navigation }) => (
          <ReviewRideScreen
            onBack={() => {
              // D3: the ride is already finished — back goes Home, never into a
              // live-trip screen. Skipping the rating is allowed.
              resetRide();
              resetRiderHomeStack(navigation);
            }}
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
                const message = getApiError(error);
                // The review is already stored (earlier submit whose response
                // was lost, or the rider came back from the payment screen).
                // Not an error for the rider: load the saved ride (it carries
                // the tip they chose) and carry on to payment.
                if (message.toLowerCase().includes('already been reviewed')) {
                  try {
                    setActiveRide(await ridesApi.get(ride.id));
                  } catch {
                    // keep the local ride; PaymentFareBreakdown polls it fresh
                  }
                  navigation.navigate('PaymentFareBreakdown');
                  return;
                }
                Alert.alert('Unable to submit review', message);
              }
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="PaymentFareBreakdown">
        {({ navigation }) => (
          <PaymentFareBreakdownScreen
            onBack={() => {
              // D3: don't return to the already-submitted ReviewRide; go Home.
              resetRide();
              resetRiderHomeStack(navigation);
            }}
            onDone={() => navigation.navigate('RideCompleted')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideCompleted">
        {({ navigation }) => (
          <RideCompletedScreen
            onGoHome={() => {
              resetRide();
              // D1: navigate() would push a second HomeDashboard on top of the
              // whole booking chain (v7) — reset so back from Home exits the
              // app instead of returning to RideCompleted.
              resetRiderHomeStack(navigation);
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};
