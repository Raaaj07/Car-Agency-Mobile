import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DriverTabParamList } from './types';

import { DriverDashboardStackNavigator } from './DriverDashboardStackNavigator';
import { BottomTabBar } from '../components/primitives/BottomTabBar';
import { colors, typography } from '../theme/theme';

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

        const handleTabPress = (id: string) => {
          switch (id) {
            case 'home':
              navigation.navigate('DashboardTab');
              break;
            case 'nav':
              navigation.navigate('TripsTab');
              break;
            case 'activity':
              navigation.navigate('EarningsTab');
              break;
            case 'profile':
              navigation.navigate('AccountTab');
              break;
          }
        };

        return <BottomTabBar activeTab={activeTabId} onTabPress={handleTabPress} mode="driver" />;
      }}
    >
      <Tab.Screen name="DashboardTab" component={DriverDashboardStackNavigator} />
      <Tab.Screen name="TripsTab">
        {() => <PlaceholderScreen title="Driver Trips History" />}
      </Tab.Screen>
      <Tab.Screen name="EarningsTab">
        {() => <PlaceholderScreen title="Earnings & Daily Payouts" />}
      </Tab.Screen>
      <Tab.Screen name="AccountTab">
        {() => <PlaceholderScreen title="Driver Profile & Vehicle Documents" />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  placeholderContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderTitle: {
    ...typography.heading,
    color: colors.primary,
    marginBottom: 8,
  },
  placeholderSub: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
