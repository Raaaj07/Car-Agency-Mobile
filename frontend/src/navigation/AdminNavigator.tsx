import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { FileText } from 'lucide-react-native';
import {
  AdminAccountStackParamList,
  AdminDriversStackParamList,
  AdminOverviewStackParamList,
  AdminRidesStackParamList,
  AdminTabParamList,
} from './types';
import { BottomTabBar } from '../components/primitives/BottomTabBar';
import { NotificationBar } from '../components/primitives/NotificationBar';
import { AdminOverviewScreen } from '../screens/admin/AdminOverviewScreen';
import { AdminDriversScreen } from '../screens/admin/AdminDriversScreen';
import { AdminDriverDetailScreen } from '../screens/admin/AdminDriverDetailScreen';
import { AdminRidesScreen } from '../screens/admin/AdminRidesScreen';
import { AdminRideDetailScreen } from '../screens/admin/AdminRideDetailScreen';
import { AdminAccountScreen } from '../screens/admin/AdminAccountScreen';
import { AdminPromosScreen } from '../screens/admin/AdminPromosScreen';
import { adminApi } from '../api/admin';
import { getSocket, subscribeSocket } from '../lib/socket';
import { useAdminStore } from '../store/adminStore';
import { colors } from '../theme/theme';

const OverviewStack = createNativeStackNavigator<AdminOverviewStackParamList>();
const DriversStack = createNativeStackNavigator<AdminDriversStackParamList>();
const RidesStack = createNativeStackNavigator<AdminRidesStackParamList>();
const AccountStack = createNativeStackNavigator<AdminAccountStackParamList>();
const Tab = createBottomTabNavigator<AdminTabParamList>();

const OverviewStackNavigator: React.FC = () => (
  <OverviewStack.Navigator screenOptions={{ headerShown: false }}>
    <OverviewStack.Screen name="AdminOverview" component={AdminOverviewScreen} />
  </OverviewStack.Navigator>
);

const DriversStackNavigator: React.FC = () => (
  <DriversStack.Navigator screenOptions={{ headerShown: false }}>
    <DriversStack.Screen name="AdminDrivers" component={AdminDriversScreen} />
    <DriversStack.Screen name="AdminDriverDetail" component={AdminDriverDetailScreen} />
  </DriversStack.Navigator>
);

const RidesStackNavigator: React.FC = () => (
  <RidesStack.Navigator screenOptions={{ headerShown: false }}>
    <RidesStack.Screen name="AdminRides" component={AdminRidesScreen} />
    <RidesStack.Screen name="AdminRideDetail" component={AdminRideDetailScreen} />
  </RidesStack.Navigator>
);

// PR-1 (Task 8): the Account tab became a stack so the Promo codes manager
// pushes over the profile card like the other detail screens.
const AccountStackNavigator: React.FC = () => (
  <AccountStack.Navigator screenOptions={{ headerShown: false }}>
    <AccountStack.Screen name="AdminAccount" component={AdminAccountScreen} />
    <AccountStack.Screen name="AdminPromos" component={AdminPromosScreen} />
  </AccountStack.Navigator>
);

/**
 * Admin console shell (spec §3.1): Overview / Drivers / Rides / Account tabs
 * with a floating BottomTabBar (admin mode). Detail screens push inside their
 * tab's stack and hide the bar. Also owns the A-11 socket wiring: badge counts
 * seeded on mount and refreshed on `admin:application:new` pushes, surfaced as
 * a NotificationBar toast.
 */
export const AdminNavigator: React.FC = () => {
  const pendingCount = useAdminStore((s) => s.pendingCount);
  const [toast, setToast] = useState<{ visible: boolean; title: string; subtitle?: string }>({
    visible: false,
    title: '',
  });

  // A-11: keep the Drivers-tab badge fresh from the admins socket room.
  useEffect(() => {
    const refreshCounts = () => {
      adminApi
        .counts()
        .then((c) => useAdminStore.getState().setPendingCount(c.pending))
        .catch(() => {
          // Badge counts are decoration — never block the console on them.
        });
    };
    const onApplicationNew = () => {
      useAdminStore.getState().notifyNewApplication();
      setToast({
        visible: true,
        title: 'New driver application',
        subtitle: 'Open Drivers to review the queue.',
      });
      refreshCounts();
    };
    const unsubscribe = subscribeSocket((socket) => {
      if (!socket) return;
      // Idempotent: fires on every reconnect without stacking listeners.
      socket.off('admin:application:new', onApplicationNew);
      socket.on('admin:application:new', onApplicationNew);
    });
    refreshCounts();
    return () => {
      unsubscribe();
      getSocket()?.off('admin:application:new', onApplicationNew);
    };
  }, []);

  return (
    <View style={styles.root}>
      <Tab.Navigator
        initialRouteName="overview"
        screenOptions={{ headerShown: false }}
        tabBar={({ navigation, state }) => {
          const routeNames: string[] = ['overview', 'drivers', 'rides', 'account'];
          const activeTabId = routeNames[state.index] ?? 'overview';
          const activeRoute = state.routes[state.index];
          const nested =
            activeRoute.name === 'drivers' || activeRoute.name === 'rides' || activeRoute.name === 'account'
              ? getFocusedRouteNameFromRoute(activeRoute) ?? activeRoute.name
              : activeRoute.name;
          const hideBar =
            nested === 'AdminDriverDetail' || nested === 'AdminRideDetail' || nested === 'AdminPromos';
          const onTabPress = (id: string) => {
            if (id === 'overview') navigation.navigate('overview');
            else if (id === 'drivers') navigation.navigate('drivers');
            else if (id === 'rides') navigation.navigate('rides');
            else navigation.navigate('account');
          };
          return (
            <BottomTabBar
              activeTab={activeTabId}
              onTabPress={onTabPress}
              mode="admin"
              visible={!hideBar}
              badges={{ drivers: pendingCount }}
            />
          );
        }}
      >
        <Tab.Screen name="overview" component={OverviewStackNavigator} options={{ title: 'Overview' }} />
        <Tab.Screen name="drivers" component={DriversStackNavigator} options={{ title: 'Drivers' }} />
        <Tab.Screen name="rides" component={RidesStackNavigator} options={{ title: 'Rides' }} />
        <Tab.Screen name="account" component={AccountStackNavigator} options={{ title: 'Account' }} />
      </Tab.Navigator>

      <NotificationBar
        visible={toast.visible}
        title={toast.title}
        subtitle={toast.subtitle}
        icon={<FileText size={18} color={colors.success} />}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
