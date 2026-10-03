import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Bus,
  Car,
  CarFront,
  CarTaxiFront,
  LucideIcon,
} from 'lucide-react-native';
import { colors, radii, shadows } from '../../theme/theme';

export interface VehicleService {
  id: 'auto' | 'mini' | 'sedan' | 'suv';
  name: string;
  defaultEta: string;
}

export const VEHICLE_SERVICES: VehicleService[] = [
  { id: 'auto', name: 'Auto', defaultEta: '3 min' },
  { id: 'mini', name: 'Mini', defaultEta: '4 min' },
  { id: 'sedan', name: 'Sedan', defaultEta: '2 min' },
  { id: 'suv', name: 'SUV', defaultEta: '6 min' },
];

// Lucide icon + soft tint per vehicle type (no emoji).
const SERVICE_ICONS: Record<VehicleService['id'], LucideIcon> = {
  auto: CarTaxiFront,
  mini: Car,
  sedan: CarFront,
  suv: Bus,
};

const SERVICE_TINTS: Record<VehicleService['id'], { bg: string; fg: string }> = {
  auto: { bg: colors.accentLight, fg: colors.accent },
  mini: { bg: colors.surface, fg: colors.primary },
  sedan: { bg: colors.successLight, fg: colors.success },
  suv: { bg: colors.warningLight, fg: colors.textAmber },
};

interface Props {
  service: VehicleService;
  etaHint?: string;
  onPress: (serviceId: string) => void;
}

export const ServiceTile: React.FC<Props> = memo(({ service, etaHint, onPress }) => {
  const displayEta = etaHint || service.defaultEta;
  const Icon = SERVICE_ICONS[service.id];
  const tint = SERVICE_TINTS[service.id];

  return (
    <TouchableOpacity
      style={styles.cell}
      onPress={() => onPress(service.id)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${service.name} cab${displayEta ? `, ${displayEta}` : ''}`}
    >
      <View style={[styles.iconBox, { backgroundColor: tint.bg }]}>
        <Icon size={26} color={tint.fg} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {service.name}
      </Text>
      {!!displayEta && (
        <View style={styles.etaBadge}>
          <Text style={styles.etaText} numberOfLines={1}>
            {displayEta}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

ServiceTile.displayName = 'ServiceTile';

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  name: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  etaBadge: {
    marginTop: 4,
    backgroundColor: colors.accentLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    maxWidth: '100%',
  },
  etaText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textAmber,
  },
});
