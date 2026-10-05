import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Car, Zap, MapPinned, Clock } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, typography, radii, shadows } from '../../theme/theme';
import { MainTabParamList } from '../../navigation/types';

type NavProp = NativeStackNavigationProp<MainTabParamList>;

const SERVICES = [
  { id: 'local', label: 'Local Ride', icon: Car, blurb: 'Quick trips around the city' },
  { id: 'airport', label: 'Airport', icon: Zap, blurb: 'Fixed-fare airport transfers' },
  { id: 'outstation', label: 'Outstation', icon: MapPinned, blurb: 'Intercity one-way or round trip' },
  { id: 'rental', label: 'Rental', icon: Clock, blurb: 'Hourly packages with waiting time' },
];

export const ServicesScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vazhi Services</Text>
      <Text style={styles.subtitle}>Pick a ride type to get started</Text>

      {SERVICES.map(({ id, label, icon: Icon, blurb }) => (
        <TouchableOpacity
          key={id}
          style={styles.card}
          onPress={() => navigation.navigate('HomeTab', { screen: 'DestinationSearch' })}
        >
          <View style={styles.iconBadge}>
            <Icon size={22} color={colors.primary} />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.cardTitle}>{label}</Text>
            <Text style={styles.cardBlurb}>{blurb}</Text>
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
  iconBadge: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  textWrap: { flex: 1 },
  cardTitle: { ...typography.cardTitle, fontSize: 16 },
  cardBlurb: { ...typography.meta, marginTop: 2 },
});