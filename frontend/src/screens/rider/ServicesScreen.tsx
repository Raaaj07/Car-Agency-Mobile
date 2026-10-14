import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Car, Zap, MapPinned, Clock } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { colors, typography, radii, shadows } from '../../theme/theme';
import { MainTabParamList } from '../../navigation/types';
import { enterRiderHome } from '../../navigation/navHelpers';

// The tiles live inside the tab navigator, not a stack — use the tab nav prop.
type NavProp = BottomTabNavigationProp<MainTabParamList>;

type ServiceTile = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  blurb: string;
  comingSoon?: boolean;
};

// D7: only Local Ride is backed by the booking flow today. The other three
// are marked as upcoming instead of silently opening the same
// DestinationSearch screen and pretending to be a different service.
const SERVICES: ServiceTile[] = [
  { id: 'local', label: 'Local Ride', icon: Car, blurb: 'Quick trips around the city' },
  { id: 'airport', label: 'Airport', icon: Zap, blurb: 'Fixed-fare airport transfers', comingSoon: true },
  { id: 'outstation', label: 'Outstation', icon: MapPinned, blurb: 'Intercity one-way or round trip', comingSoon: true },
  { id: 'rental', label: 'Rental', icon: Clock, blurb: 'Hourly packages with waiting time', comingSoon: true },
];

export const ServicesScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>Vazhi Services</Text>
      <Text style={styles.subtitle}>Pick a ride type to get started</Text>

      {SERVICES.map(({ id, label, icon: Icon, blurb, comingSoon }) => (
        <TouchableOpacity
          key={id}
          style={[styles.card, comingSoon && styles.cardDisabled]}
          disabled={!!comingSoon}
          onPress={() => {
            // D6/D7: enter the Home stack through the shared helper — any
            // half-finished booking underneath is pruned first, so back from
            // DestinationSearch goes Home, then to the previously active tab.
            enterRiderHome(navigation, 'DestinationSearch', { focus: 'pickup' });
          }}
        >
          <View style={styles.iconBadge}>
            <Icon size={22} color={colors.primary} />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.cardTitle}>{label}</Text>
            <Text style={styles.cardBlurb}>{comingSoon ? 'Coming soon' : blurb}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: 60 },
  title: { ...typography.heading, fontSize: 24, marginBottom: 4 },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: radii.card, padding: 16, marginBottom: 14, ...shadows.card,
  },
  cardDisabled: { opacity: 0.55 },
  iconBadge: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  textWrap: { flex: 1 },
  cardTitle: { ...typography.cardTitle, fontSize: 16 },
  cardBlurb: { ...typography.meta, marginTop: 2 },
});