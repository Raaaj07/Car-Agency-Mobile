import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { RiderTabParamList } from './types';

import { RiderHomeStackNavigator } from './RiderHomeStackNavigator';
import { BottomTabBar } from '../components/primitives/BottomTabBar';
import { colors, typography } from '../theme/theme';

const Tab = createBottomTabNavigator<RiderTabParamList>();

const PlaceholderScreen: React.FC<{ title: string }> = ({ title }) => (
  <View style={styles.placeholderContainer}>
    <Text style={styles.placeholderTitle}>{title}</Text>
    <Text style={styles.placeholderSub}>Vazhi Services & Account Features</Text>
  </View>
);

export const RiderTabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={{ headerShown: false }}
      tabBar={({ navigation, state }) => {
        const routeNames = ['home', 'explore', 'activity', 'profile'];
        const activeTabId = routeNames[state.index] || 'home';

        const handleTabPress = (id: string) => {
          switch (id) {
            case 'home':
              navigation.navigate('HomeTab');
              break;
            case 'explore':
              navigation.navigate('ServicesTab');
              break;
            case 'activity':
              navigation.navigate('MyRidesTab');
              break;
            case 'profile':
              navigation.navigate('ProfileTab');
              break;
          }
        };

        return <BottomTabBar activeTab={activeTabId} onTabPress={handleTabPress} mode="rider" />;
      }}
    >
      <Tab.Screen name="HomeTab" component={RiderHomeStackNavigator} />
      <Tab.Screen name="ServicesTab">
        {() => <PlaceholderScreen title="Vazhi Services" />}
      </Tab.Screen>
      <Tab.Screen name="MyRidesTab">
        {() => <PlaceholderScreen title="My Rides History" />}
      </Tab.Screen>
      <Tab.Screen name="ProfileTab">
        {() => <PlaceholderScreen title="User Profile & Settings" />}
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
