import React, { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DriverMainTabParamList, MainTabParamList } from './types';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
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
import { subscribeSocket } from '../lib/socket';

const RiderTab = createBottomTabNavigator<MainTabParamList>();
const DriverTab = createBottomTabNavigator<DriverMainTabParamList>();

const BOOKING_FLOW_ROUTES = [
  'DestinationSearch', 'VehicleSelection', 'RideDetails', 'FindingDriver',
  'YouGotTheRide', 'DriverEnRoute', 'TripProgress', 'ReviewRide',
  'PaymentFareBreakdown', 'RideCompleted',
];
const DRIVER_FLOW_ROUTES = ['RideRequestNearby', 'TurnByTurnNavigation', 'DriverOtpEntry'];

// Mode-split shell. Rider mode (default): Home, Trips, Profile — no driver UI
// is registered in the tree. Driver mode (approved + activeMode): Dashboard,
// Trips, Earnings, Profile — the rider booking Home is not registered.
// Also owns forced-mode handling: server 'driver:status' events and
// foreground /auth/me refreshes drop non-approved users back to Rider mode.
export const MainTabNavigator: React.FC = () => {
  const activeMode = useAuthStore((s) => s.activeMode);
  const driverStatus = useAuthStore((s) => s.user?.driverStatus);
  const isDriverMode = driverStatus === 'approved' && activeMode === 'driver';

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

  if (isDriverMode) {
    return (
      <DriverTab.Navigator
        initialRouteName="DashboardTab"
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
