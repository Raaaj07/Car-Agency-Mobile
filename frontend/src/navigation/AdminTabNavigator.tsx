import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LogOut, ShieldCheck, Car, Receipt } from 'lucide-react-native';
import { AdminTabParamList } from './types';
import { AdminApplicationsScreen } from '../screens/admin/AdminApplicationsScreen';
import { AdminApplicationDetailScreen } from '../screens/admin/AdminApplicationDetailScreen';
import { AdminDriversScreen } from '../screens/admin/AdminDriversScreen';
import { AdminRidesScreen } from '../screens/admin/AdminRidesScreen';
import { useAuthStore } from '../store/authStore';
import { useRideStore } from '../store/rideStore';
import { colors, typography } from '../theme/theme';

const Tab = createBottomTabNavigator<AdminTabParamList>();

const ApplicationsStack: React.FC = () => {
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  if (selected) {
    return (
      <AdminApplicationDetailScreen
        applicationId={selected}
        onBack={() => setSelected(null)}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    );
  }
  return (
    <View style={{ flex: 1 }} key={refreshKey}>
      <AdminApplicationsScreen onOpen={setSelected} />
    </View>
  );
};

export const AdminTabNavigator: React.FC = () => {
  const logout = useAuthStore((s) => s.logout);
  const resetRide = useRideStore((s) => s.resetRide);

  const confirmLogout = () => {
    Alert.alert('Log out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          resetRide();
          logout();
        },
      },
    ]);
  };

  return (
    <Tab.Navigator
      initialRouteName="ApplicationsTab"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarStyle: { height: 64 },
      }}
    >
      <Tab.Screen
        name="ApplicationsTab"
        component={ApplicationsStack}
        options={{
          title: 'Applications',
          tabBarIcon: ({ color, size }) => <ShieldCheck size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="DriversTab"
        component={AdminDriversScreen}
        options={{
          title: 'Drivers',
          tabBarIcon: ({ color, size }) => <Car size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="RidesTab"
        component={AdminRidesScreen}
        options={{
          title: 'Rides',
          tabBarIcon: ({ color, size }) => <Receipt size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="AdminAccountTab"
        options={{
          title: 'Log out',
          tabBarIcon: ({ color, size }) => <LogOut size={size} color={color} />,
          tabBarLabelStyle: styles.logoutLabel,
        }}
      >
        {() => (
          <View style={styles.logoutWrap}>
            <Text style={styles.logoutTitle}>Admin session</Text>
            <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout}>
              <Text style={styles.logoutText}>Log out</Text>
            </TouchableOpacity>
          </View>
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  logoutLabel: { color: colors.danger },
  logoutWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  logoutTitle: { ...typography.heading, fontSize: 20 },
  logoutBtn: { backgroundColor: colors.danger, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  logoutText: { color: '#fff', fontWeight: '700' },
});
