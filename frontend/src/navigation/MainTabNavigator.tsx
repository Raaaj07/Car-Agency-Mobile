import React, { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DriverMainTabParamList, MainTabParamList, RootStackParamList } from './types';
import { CommonActions, getFocusedRouteNameFromRoute, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RiderHomeStackNavigator } from './RiderHomeStackNavigator';
import { DriverDashboardStackNavigator } from './DriverDashboardStackNavigator';
import { RideHistoryScreen } from '../screens/rider/RideHistoryScreen';
import { ServicesScreen } from '../screens/rider/ServicesScreen';
import { DriverTripsScreen } from '../screens/driver/DriverTripsScreen';
import { DriverEarningsScreen } from '../screens/driver/DriverEarningsScreen';
import { ProfileScreen } from '../screens/rider/ProfileScreen';
import { BottomTabBar } from '../components/primitives/BottomTabBar';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';
import { refreshSocketAuth, subscribeSocket } from '../lib/socket';
import { restoreActiveRide, clearRestoredRiderRide } from '../hooks/useActiveRide';
import { useRideAnnouncements } from '../hooks/useRideAnnouncements';

const RiderTab = createBottomTabNavigator<MainTabParamList>();
const DriverTab = createBottomTabNavigator<DriverMainTabParamList>();

const BOOKING_FLOW_ROUTES = [
  'DestinationSearch', 'VehicleSelection', 'RideDetails', 'FindingDriver',
  'YouGotTheRide', 'DriverEnRoute', 'TripProgress', 'ReviewRide',
  'PaymentFareBreakdown', 'RideCompleted',
];
const DRIVER_FLOW_ROUTES = ['RideRequestNearby', 'TurnByTurnNavigation', 'DriverOtpEntry', 'DriverPayment'];

// Mode-split shell. Rider mode (default): Home, Trips, Profile — no driver UI
// is registered in the tree. Driver mode (approved + activeMode): Dashboard,
// Trips, Earnings, Profile — the rider booking Home is not registered.
// Also owns forced-mode handling: server 'driver:status' events and
// foreground /auth/me refreshes drop non-approved users back to Rider mode.
export const MainTabNavigator: React.FC = () => {
  const activeMode = useAuthStore((s) => s.activeMode);
  const driverStatus = useAuthStore((s) => s.user?.driverStatus);
  const isDriverMode = driverStatus === 'approved' && activeMode === 'driver';
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Spoken ride updates (settings: Profile > Audio Announcements).
  useRideAnnouncements(isDriverMode ? 'driver' : 'rider');

  // D9: the rider and driver tab trees share this one `Main` route, so the
  // nested tab state from the old tree leaks into the new one (landing on
  // Profile/Trips instead of Home/Dashboard). When the mode flips (manual
  // switch, or a forced drop back to rider), reset the root to a fresh `Main`
  // so the new tree opens on its own initial tab. The ref starts at the
  // current mode, so the remounted Main does not reset again.
  const prevDriverModeRef = useRef(isDriverMode);
  useEffect(() => {
    if (prevDriverModeRef.current === isDriverMode) return;
    prevDriverModeRef.current = isDriverMode;
    rootNavigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Main' }] }),
    );
  }, [isDriverMode, rootNavigation]);

  useEffect(() => {
    const forceRider = (why: string) => {
      const st = useAuthStore.getState();
      if (st.activeMode !== 'rider') st.setActiveMode('rider');
      Alert.alert('Driver mode unavailable', why);
    };

    const onDriverStatus = (payload: any) => {
      if (!payload) return;
      // Approval (or any change): refresh canonical state so the Profile
      // switch button appears without a restart.
      authApi
        .me()
        .then((me) => {
          useAuthStore.getState().updateUser(me);
          if (me.driverStatus !== 'approved') {
            useAuthStore.getState().setActiveMode('rider');
          }
        })
        .catch(() => {});
      if (payload.status === 'approved') return;
      forceRider(
        payload.status === 'suspended'
          ? 'Your driver access was suspended. Contact support.'
          : 'Your driver application was rejected. See Profile for the reason.',
      );
    };

    const unsub = subscribeSocket((sock) => {
      sock?.off('driver:status', onDriverStatus);
      sock?.on('driver:status', onDriverStatus);
    });

    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      // Android may have killed the websocket while backgrounded; the library's
      // backoff timer can be frozen too, so reconnect right away.
      refreshSocketAuth();
      authApi
        .me()
        .then((me) => {
          const prev = useAuthStore.getState().user?.driverStatus;
          useAuthStore.getState().updateUser(me);
          if (me.driverStatus !== 'approved' && prev === 'approved') {
            forceRider('Your driver access changed. Check Profile for details.');
          }
        })
        .catch(() => {});
    });

    return () => {
      unsub();
      sub.remove();
    };
  }, []);

  // Restore the rider's active ride only while in rider mode (once per mode
  // change, so switching back to rider restores again). Entering driver mode
  // clears any restored rider booking so DriverDashboard's pendingRequest can
  // never show the user's own rider booking as a job offer. This is a
  // separate effect from the socket/AppState listeners above (they keep
  // their [] deps and never re-subscribe).
  useEffect(() => {
    if (isDriverMode) {
      clearRestoredRiderRide();
      return;
    }
    restoreActiveRide().catch(() => {});
  }, [isDriverMode]);

  if (isDriverMode) {
    return (
      <DriverTab.Navigator
        initialRouteName="DashboardTab"
        // D6: hardware back returns to the previously active tab (default
        // 'firstRoute' jumped to Dashboard, skipping the visited tab).
        backBehavior="history"
        screenOptions={{ headerShown: false }}
        tabBar={({ navigation, state }) => {
          const routeNames = ['home', 'nav', 'activity', 'profile'];
          const activeTabId = routeNames[state.index] || 'home';
          const activeRoute = state.routes[state.index];
          const nested =
            activeRoute.name === 'DashboardTab'
              ? getFocusedRouteNameFromRoute(activeRoute) ?? 'DriverDashboard'
              : '';
          const hide = DRIVER_FLOW_ROUTES.includes(nested);
          const onTabPress = (id: string) => {
            if (id === 'home') navigation.navigate('DashboardTab');
            else if (id === 'nav') navigation.navigate('TripsTab');
            else if (id === 'activity') navigation.navigate('EarningsTab');
            else navigation.navigate('ProfileTab');
          };
          return <BottomTabBar activeTab={activeTabId} onTabPress={onTabPress} mode="driver" visible={!hide} />;
        }}
      >
        <DriverTab.Screen name="DashboardTab" component={DriverDashboardStackNavigator} />
        <DriverTab.Screen name="TripsTab" component={DriverTripsScreen} />
        <DriverTab.Screen name="EarningsTab" component={DriverEarningsScreen} />
        <DriverTab.Screen name="ProfileTab" component={ProfileScreen} />
      </DriverTab.Navigator>
    );
  }

  return (
    <RiderTab.Navigator
      initialRouteName="HomeTab"
      // D6: hardware back returns to the previously active tab (default
      // 'firstRoute' jumped to Home, skipping e.g. Profile).
      backBehavior="history"
      screenOptions={{ headerShown: false }}
      tabBar={({ navigation, state }) => {
        const routeNames = ['home', 'explore', 'activity', 'profile'];
        const activeTabId = routeNames[state.index] || 'home';
        const activeRoute = state.routes[state.index];
        const nested =
          activeRoute.name === 'HomeTab'
            ? getFocusedRouteNameFromRoute(activeRoute) ?? 'HomeDashboard'
            : '';
        const hide = BOOKING_FLOW_ROUTES.includes(nested);
        const onTabPress = (id: string) => {
          if (id === 'home') navigation.navigate('HomeTab');
          else if (id === 'explore') navigation.navigate('ServicesTab');
          else if (id === 'activity') navigation.navigate('TripsTab');
          else navigation.navigate('ProfileTab');
        };
        return <BottomTabBar activeTab={activeTabId} onTabPress={onTabPress} mode="rider" visible={!hide} />;
      }}
    >
      <RiderTab.Screen name="HomeTab" component={RiderHomeStackNavigator} />
      <RiderTab.Screen name="ServicesTab" component={ServicesScreen} />
      <RiderTab.Screen name="TripsTab" component={RideHistoryScreen} />
      <RiderTab.Screen name="ProfileTab" component={ProfileScreen} />
    </RiderTab.Navigator>
  );
};
