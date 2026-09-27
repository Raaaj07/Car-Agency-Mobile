import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DriverTabParamList } from './types';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { DriverDashboardStackNavigator } from './DriverDashboardStackNavigator';
import { DriverTripsScreen } from '../screens/driver/DriverTripsScreen';
import { DriverEarningsScreen } from '../screens/driver/DriverEarningsScreen';
import { BottomTabBar } from '../components/primitives/BottomTabBar';
import { colors, typography } from '../theme/theme';
import { DriverAccountScreen } from '../screens/driver/DriverAccountScreen';

const DRIVER_TRIP_FLOW_ROUTES = ['RideRequestNearby', 'TurnByTurnNavigation', 'DriverOtpEntry'];

const Tab = createBottomTabNavigator<DriverTabParamList>();

const PlaceholderScreen: React.FC<{ title: string }> = ({ title }) => (
  <View style={styles.placeholderContainer}>
    <Text style={styles.placeholderTitle}>{title}</Text>
    <Text style={styles.placeholderSub}>Vazhi Driver Partner Features</Text>
  </View>
);

export const DriverTabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      initialRouteName="DashboardTab"
      screenOptions={{ headerShown: false }}
      tabBar={({ navigation, state }) => {
        const routeNames = ['home', 'nav', 'activity', 'profile'];
        const activeTabId = routeNames[state.index] || 'home';
        const activeRoute = state.routes[state.index];

        const nestedRouteName =
          activeRoute.name === 'DashboardTab'
            ? getFocusedRouteNameFromRoute(activeRoute) ?? 'DriverDashboard'
            : undefined;
        const isBarVisible = !nestedRouteName || !DRIVER_TRIP_FLOW_ROUTES.includes(nestedRouteName);

        const handleTabPress = (id: string) => {
          switch (id) {
            case 'home': navigation.navigate('DashboardTab'); break;
            case 'nav': navigation.navigate('TripsTab'); break;
            case 'activity': navigation.navigate('EarningsTab'); break;
            case 'profile': navigation.navigate('AccountTab'); break;
          }
        };

        return <BottomTabBar activeTab={activeTabId} onTabPress={handleTabPress} mode="driver" visible={isBarVisible} />;
      }}
    >
      <Tab.Screen name="DashboardTab" component={DriverDashboardStackNavigator} />
      <Tab.Screen name="TripsTab" component={DriverTripsScreen} />
      <Tab.Screen name="EarningsTab" component={DriverEarningsScreen} />
      <Tab.Screen name="AccountTab" component={DriverAccountScreen} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  placeholderContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholderTitle: { ...typography.heading, color: colors.primary, marginBottom: 8 },
  placeholderSub: { ...typography.body, color: colors.textSecondary },
});