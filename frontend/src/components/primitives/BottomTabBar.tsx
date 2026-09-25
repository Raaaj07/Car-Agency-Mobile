import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Home, Compass, Clock, User, ShieldAlert, Navigation } from 'lucide-react-native';
import { colors, radii, shadows, typography } from '../../theme/theme';

export interface TabItem {
  id: string;
  label: string;
  iconName: 'home' | 'explore' | 'activity' | 'profile' | 'nav';
}

interface BottomTabBarProps {
  activeTab: string;
  onTabPress: (id: string) => void;
  mode?: 'rider' | 'driver';
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onTabPress,
  mode = 'rider',
}) => {
  const riderTabs: TabItem[] = [
    { id: 'home', label: 'Home', iconName: 'home' },
    { id: 'explore', label: 'Services', iconName: 'explore' },
    { id: 'activity', label: 'My Rides', iconName: 'activity' },
    { id: 'profile', label: 'Profile', iconName: 'profile' },
  ];

  const driverTabs: TabItem[] = [
    { id: 'home', label: 'Dashboard', iconName: 'home' },
    { id: 'nav', label: 'Trips', iconName: 'nav' },
    { id: 'activity', label: 'Earnings', iconName: 'activity' },
    { id: 'profile', label: 'Account', iconName: 'profile' },
  ];

  const tabs = mode === 'rider' ? riderTabs : driverTabs;

  const renderIcon = (name: string, active: boolean) => {
    const color = active ? colors.primary : colors.textMuted;
    const size = 22;
    switch (name) {
      case 'home':
        return <Home size={size} color={color} />;
      case 'explore':
        return <Compass size={size} color={color} />;
      case 'activity':
        return <Clock size={size} color={color} />;
      case 'nav':
        return <Navigation size={size} color={color} />;
      case 'profile':
      default:
        return <User size={size} color={color} />;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tab}
              onPress={() => onTabPress(tab.id)}
              activeOpacity={0.7}
            >
              {renderIcon(tab.iconName, isActive)}
              <Text style={[styles.label, isActive ? styles.labelActive : null]}>
                {tab.label}
              </Text>
              {isActive && <View style={styles.activeIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  bar: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#EEECF2',
    alignItems: 'center',
    justifyContent: 'space-around',
    ...shadows.cardHover,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  label: {
    ...typography.meta,
    fontSize: 11,
    marginTop: 3,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  activeIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: 2,
  },
});
