import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Phone, MessageSquare, Shield, Clock, MapPin, AlertCircle } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';

interface Props {
  onStartTrip: () => void;
  onCancelRide: () => void;
}

export const DriverEnRouteScreen: React.FC<Props> = ({ onStartTrip, onCancelRide }) => {
  return (
    <View style={styles.container}>
      <MapPlaceholder
        showDriverPin
        driverEta="8 MIN"
        pickupText="MG Road Metro Entrance Gate 2"
        dropText="Indiranagar 100 Feet Rd"
      />

      {/* Floating Status Pill Header */}
      <View style={styles.statusPill}>
        <Clock size={16} color="#FFFFFF" />
        <Text style={styles.statusPillText}>Driver is 8 mins away from pickup</Text>
      </View>

      {/* Bottom Sheet Card */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        <View style={styles.driverRow}>
          <Avatar name="Rajesh Kumar" rating={4.9} size={50} online />
          <View style={styles.driverMeta}>
            <Text style={styles.driverName}>Rajesh Kumar</Text>
            <Text style={styles.vehicleInfo}>White Maruti Dzire • KA 05 MN 4821</Text>
          </View>

          <View style={styles.contactGroup}>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: colors.successLight }]}>
              <Phone size={18} color={colors.success} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: '#EEF2FF' }]}>
              <MessageSquare size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.pickupCard}>
          <MapPin size={18} color={colors.success} />
          <View style={styles.pickupTextWrap}>
            <Text style={styles.pickupLabel}>PICKUP LOCATION</Text>
            <Text style={styles.pickupAddr} numberOfLines={1}>MG Road Metro Entrance Gate 2</Text>
          </View>
        </View>

        <View style={styles.btnRow}>
          <Button
            title="Cancel"
            onPress={onCancelRide}
            variant="outline"
            size="medium"
            style={styles.cancelBtn}
          />
          <Button
            title="Driver Arrived (Start)"
            onPress={onStartTrip}
            variant="primary"
            size="medium"
            style={styles.startBtn}
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
  statusPill: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
    gap: 8,
    ...shadows.card,
  },
  statusPillText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    ...shadows.modal,
    gap: 14,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverMeta: {
    flex: 1,
  },
  driverName: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  vehicleInfo: {
    ...typography.meta,
    fontSize: 12,
  },
  contactGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  pickupTextWrap: {
    flex: 1,
  },
  pickupLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
  },
  pickupAddr: {
    ...typography.bodyBold,
    fontSize: 13,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
  },
  startBtn: {
    flex: 2,
  },
});
