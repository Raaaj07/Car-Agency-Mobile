import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Compass, Clock, User, Navigation } from 'lucide-react-native';
import { colors, shadows, typography } from '../../theme/theme';

export const TAB_BAR_HEIGHT = 64 + 12; // 76px

export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom;
}

export interface TabItem {
  id: string;
  label: string;
  iconName: 'home' | 'explore' | 'activity' | 'profile' | 'nav';
}

interface BottomTabBarProps {
  activeTab: string;
  onTabPress: (id: string) => void;
  mode?: 'rider' | 'driver';
  visible?: boolean;
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onTabPress,
  mode = 'rider',
  visible = true,
}) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(visible ? 0 : 120)).current;
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: visible ? 0 : 120,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

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
      case 'home': return <Home size={size} color={color} />;
      case 'explore': return <Compass size={size} color={color} />;
      case 'activity': return <Clock size={size} color={color} />;
      case 'nav': return <Navigation size={size} color={color} />;
      case 'profile':
      default: return <User size={size} color={color} />;
    }
  };

  const dynamicPaddingBottom = Math.max(insets.bottom, 12);

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.container,
        { paddingBottom: dynamicPaddingBottom, transform: [{ translateY }], opacity },
      ]}
    >
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity key={tab.id} style={styles.tab} onPress={() => onTabPress(tab.id)} activeOpacity={0.7}>
              {renderIcon(tab.iconName, isActive)}
              <Text style={[styles.label, isActive ? styles.labelActive : null]}>{tab.label}</Text>
              {isActive && <View style={styles.activeIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'transparent', paddingHorizontal: 16 },
  bar: { flexDirection: 'row', height: 64, backgroundColor: '#FFFFFF', borderRadius: 32, borderWidth: 1, borderColor: '#EEECF2', alignItems: 'center', justifyContent: 'space-around', ...shadows.cardHover },
  tab: { alignItems: 'center', justifyContent: 'center', flex: 1, height: '100%' },
  label: { ...typography.meta, fontSize: 11, marginTop: 3, color: colors.textMuted },
  labelActive: { color: colors.primary, fontWeight: '700' },
  activeIndicator: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent, marginTop: 2 },
});