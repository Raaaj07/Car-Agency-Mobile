import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Clock, Users, ArrowRight, CreditCard, ChevronDown } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';
import { Header } from '../../components/primitives/Header';
import { useRideStore, VehicleOption } from '../../store/rideStore';

const vehicles: VehicleOption[] = [
  {
    id: 'auto',
    name: 'Vazhi Auto',
    type: 'Affordable 3-wheeler',
    price: '₹110',
    numericPrice: 110,
    eta: '3 min',
    seats: 3,
    badge: 'Popular',
    icon: '🛺',
  },
  {
    id: 'mini',
    name: 'Economy Mini',
    type: 'Compact hatchbacks',
    price: '₹180',
    numericPrice: 180,
    eta: '4 min',
    seats: 4,
    icon: '🚗',
  },
  {
    id: 'sedan',
    name: 'Comfort Sedan',
    type: 'Spacious AC sedans',
    price: '₹240',
    numericPrice: 240,
    eta: '2 min',
    seats: 4,
    badge: 'Fastest',
    icon: '🚘',
  },
  {
    id: 'suv',
    name: 'Premium SUV',
    type: '6-seater family rides',
    price: '₹350',
    numericPrice: 350,
    eta: '6 min',
    seats: 6,
    icon: '🚙',
  },
];

interface Props {
  onBack?: () => void;
  onConfirmVehicle?: (vehicle: VehicleOption) => void;
}

export const VehicleSelectionScreen: React.FC<Props> = ({ onBack, onConfirmVehicle }) => {
  const storeSelectedVehicle = useRideStore((state) => state.selectedVehicle);
  const setSelectedVehicleStore = useRideStore((state) => state.setSelectedVehicle);
  const pickup = useRideStore((state) => state.pickup);
  const dropoff = useRideStore((state) => state.dropoff);

  const [selectedId, setSelectedId] = useState<string>(storeSelectedVehicle?.id || 'sedan');
  const selectedVehicle = vehicles.find((v) => v.id === selectedId) || vehicles[2];

  const handleSelect = (v: VehicleOption) => {
    setSelectedId(v.id);
    setSelectedVehicleStore(v);
  };

  const handleConfirm = () => {
    setSelectedVehicleStore(selectedVehicle);
    if (onConfirmVehicle) {
      onConfirmVehicle(selectedVehicle);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Map View */}
      <View style={styles.mapWrap}>
        <MapPlaceholder pickupText={pickup} dropText={dropoff} showRoute />
        {onBack && <Header onBack={onBack} transparent style={styles.mapHeader} />}
      </View>

      {/* Vehicle Options Bottom Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />
        <Text style={styles.sheetTitle}>Choose a Ride</Text>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {vehicles.map((v) => {
            const isSelected = selectedId === v.id;
            return (
              <Card
                key={v.id}
                onPress={() => handleSelect(v)}
                selected={isSelected}
                style={styles.vehicleCard}
              >
                <View style={styles.vehicleRow}>
                  <Text style={styles.vehicleEmoji}>{v.icon}</Text>

                  <View style={styles.infoCol}>
                    <View style={styles.nameRow}>
                      <Text style={styles.vehicleName}>{v.name}</Text>
                      {v.badge && (
                        <View
                          style={[
                            styles.badge,
                            { backgroundColor: v.badge === 'Fastest' ? colors.successLight : colors.accentLight },
                          ]}
                        >
                          <Text
                            style={[
                              styles.badgeText,
                              { color: v.badge === 'Fastest' ? colors.success : colors.accent },
                            ]}
                          >
                            {v.badge}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.vehicleType}>{v.type}</Text>
                    <View style={styles.metaRow}>
                      <Clock size={12} color={colors.textMuted} />
                      <Text style={styles.metaText}>{v.eta} away</Text>
                      <Text style={styles.metaDot}>•</Text>
                      <Users size={12} color={colors.textMuted} />
                      <Text style={styles.metaText}>{v.seats} seats</Text>
                    </View>
                  </View>

                  <View style={styles.priceCol}>
                    <Text style={[styles.priceText, isSelected && styles.priceTextActive]}>
                      {v.price}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>

        {/* Footer Bar with Payment Choice & Action */}
        <View style={styles.footerPanel}>
          <TouchableOpacity style={styles.paymentSelector}>
            <CreditCard size={18} color={colors.primary} />
            <Text style={styles.paymentText}>Cash / UPI</Text>
            <ChevronDown size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          <Button
            title={`Book ${selectedVehicle.name}`}
            onPress={handleConfirm}
            variant="accent"
            size="large"
            rightIcon={<ArrowRight size={20} color="#FFFFFF" />}
            style={styles.confirmBtn}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapWrap: {
    height: '42%',
    position: 'relative',
  },
  mapHeader: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
  },
  bottomSheet: {
    flex: 1,
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -20,
    paddingTop: 12,
    paddingHorizontal: 20,
    ...shadows.modal,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    ...typography.subheading,
    fontSize: 18,
    marginBottom: 14,
  },
  list: {
    gap: 12,
    paddingBottom: 100,
  },
  vehicleCard: {
    padding: 14,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleEmoji: {
    fontSize: 34,
    marginRight: 14,
  },
  infoCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vehicleName: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  badgeText: {
    ...typography.metaBold,
    fontSize: 10,
  },
  vehicleType: {
    ...typography.meta,
    fontSize: 12,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  metaText: {
    ...typography.meta,
    fontSize: 11,
  },
  metaDot: {
    color: colors.textMuted,
  },
  priceCol: {
    alignItems: 'flex-end',
  },
  priceText: {
    ...typography.heading,
    fontSize: 18,
  },
  priceTextActive: {
    color: colors.accent,
  },
  footerPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    gap: 12,
    ...shadows.card,
  },
  paymentSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.md,
    gap: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentText: {
    ...typography.bodyBold,
    fontSize: 13,
  },
  confirmBtn: {
    width: '100%',
  },
});
