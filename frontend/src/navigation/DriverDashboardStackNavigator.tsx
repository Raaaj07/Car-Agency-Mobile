import React, { useRef, useState } from 'react';
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
import { DriverPaymentScreen } from '../screens/driver/DriverPaymentScreen';

const Stack = createNativeStackNavigator<DriverDashboardStackParamList>();

export const DriverDashboardStackNavigator: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | undefined>();
  // Guards against a double-tap on "Accept Ride" firing accept() twice.
  const acceptingRef = useRef(false);

  return (
    <Stack.Navigator
      initialRouteName="DriverDashboard"
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="DriverDashboard">
        {({ navigation }) => (
          <DriverDashboardScreen
            onRideRequest={() => navigation.navigate('RideRequestNearby')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideRequestNearby">
        {({ navigation }) => {
          const leave = () => {
            if (navigation.canGoBack()) navigation.goBack();
          };
          return (
            <RideRequestNearbyScreen
              onAccept={async () => {
                if (acceptingRef.current) return;
                const ride = useRideStore.getState().activeRide;
                if (!ride) {
                  Alert.alert('Ride unavailable', 'This ride request is no longer available.');
                  leave();
                  return;
                }
                acceptingRef.current = true;
                try {
                  let current = await ridesApi.accept(ride.id);
                  // The ride is ACCEPTED at this point. markEnRoute is only a
                  // status nicety (start() also accepts `matched`), so a hiccup
                  // here must not strand the driver with an accepted ride and
                  // an error screen.
                  try {
                    current = await ridesApi.enRoute(ride.id);
                  } catch {
                    // keep the `matched` ride returned by accept()
                  }
                  useRideStore.getState().setActiveRide(current);
                  // replace (not navigate): the request screen must UNMOUNT so
                  // its countdown can never fire a decline on the accepted ride.
                  navigation.replace('TurnByTurnNavigation', { phase: 'to_pickup' });
                } catch (error) {
                  // Offer gone (expired / taken / cancelled): drop the stale card.
                  useRideStore.getState().setActiveRide(null);
                  Alert.alert('Unable to accept ride', getApiError(error));
                  leave();
                } finally {
                  acceptingRef.current = false;
                }
              }}
              onDecline={async () => {
                const ride = useRideStore.getState().activeRide;
                try {
                  if (ride) await ridesApi.decline(ride.id);
                } catch (error) {
                  Alert.alert('Unable to decline ride', getApiError(error));
                }
                useRideStore.getState().setActiveRide(null);
                leave();
              }}
              // Countdown hit 0: the server's 15 s timer is releasing the
              // offer anyway, so this is best-effort and must never show an
              // error ("Nothing to decline") to the driver.
              onExpire={async () => {
                const ride = useRideStore.getState().activeRide;
                if (ride && ride.status === 'requested') {
                  await ridesApi.decline(ride.id).catch(() => {});
                  useRideStore.getState().setActiveRide(null);
                }
                leave();
              }}
            />
          );
        }}
      </Stack.Screen>

      <Stack.Screen name="TurnByTurnNavigation">
        {({ navigation, route }) => (
          <TurnByTurnNavigationScreen
            phase={route.params?.phase ?? 'to_pickup'}
            isSubmitting={isSubmitting}
            onRideCancelled={() => {
              Alert.alert('Ride cancelled', 'This trip was cancelled.');
              useRideStore.getState().setActiveRide(null);
              navigation.reset({ index: 0, routes: [{ name: 'DriverDashboard' }] });
            }}
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
                  // Payment is the next step: show the UPI QR + "Amount Received"
                  // before the driver returns to the dashboard. reset() so the
                  // finished trip screens cannot be navigated back into.
                  navigation.reset({
                    index: 1,
                    routes: [{ name: 'DriverDashboard' }, { name: 'DriverPayment' }],
                  });
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
                // reset (not navigate): collapses [Dashboard, TurnByTurn(to_pickup),
                // OtpEntry] into [Dashboard, TurnByTurn(in_progress)] so there is
                // exactly one live trip screen / location watcher.
                navigation.reset({
                  index: 1,
                  routes: [
                    { name: 'DriverDashboard' },
                    { name: 'TurnByTurnNavigation', params: { phase: 'in_progress' } },
                  ],
                });
              } catch (error) {
                setOtpError(getApiError(error));
              } finally {
                setIsSubmitting(false);
              }
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="DriverPayment">
        {({ navigation }) => (
          <DriverPaymentScreen onDone={() => navigation.navigate('RideAvailableAgain')} />
        )}
      </Stack.Screen>

      <Stack.Screen name="RideAvailableAgain">
        {({ navigation }) => (
          <RideAvailableAgainScreen
            onBackToDashboard={() => {
              // Trip fully finished — clear it so nothing stale lingers.
              useRideStore.getState().resetRide();
              navigation.reset({ index: 0, routes: [{ name: 'DriverDashboard' }] });
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};
