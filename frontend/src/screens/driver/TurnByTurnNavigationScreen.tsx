import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CornerUpRight, Navigation, Phone, Gauge, MapPin, CheckCircle } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';

interface Props {
  onArrived: () => void;
}

export const TurnByTurnNavigationScreen: React.FC<Props> = ({ onArrived }) => {
  return (
    <View style={styles.container}>
      <MapPlaceholder
        darkTheme
        showRoute
        showDriverPin
        driverEta="10 MIN"
        pickupText="Navigating to Indiranagar"
        dropText="Indiranagar 100 Feet Rd"
      />

      {/* Top Direction Instruction Header */}
      <View style={styles.navHeader}>
        <View style={styles.arrowIconWrap}>
          <CornerUpRight size={28} color="#FFFFFF" />
        </View>
        <View style={styles.navTextWrap}>
          <Text style={styles.distText}>IN 200 METERS</Text>
          <Text style={styles.turnInstruction}>Turn Right onto 100 Feet Road</Text>
        </View>

        <View style={styles.speedBadge}>
          <Gauge size={14} color={colors.accent} />
          <Text style={styles.speedVal}>45 km/h</Text>
        </View>
      </View>

      {/* Bottom Navigation Control Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.etaTitle}>10 MINS</Text>
            <Text style={styles.etaSub}>3.2 km remaining to destination</Text>
          </View>

          <TouchableOpacity style={styles.callBtn}>
            <Phone size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.destBox}>
          <MapPin size={18} color={colors.danger} />
          <Text style={styles.destText} numberOfLines={1}>
            Indiranagar 100 Feet Road, Hub 4
          </Text>
        </View>

        <Button
          title="Arrived at Destination"
          onPress={onArrived}
          variant="success"
          size="large"
          leftIcon={<CheckCircle size={20} color="#FFFFFF" />}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  navHeader: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: radii.card,
    ...shadows.card,
    gap: 12,
  },
  arrowIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTextWrap: {
    flex: 1,
  },
  distText: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.accent,
    letterSpacing: 1,
  },
  turnInstruction: {
    ...typography.cardTitle,
    fontSize: 16,
    color: '#FFFFFF',
  },
  speedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    gap: 4,
  },
  speedVal: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
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
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  etaTitle: {
    ...typography.heading,
    fontSize: 26,
    color: colors.primary,
  },
  etaSub: {
    ...typography.meta,
    fontSize: 12,
  },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  destText: {
    ...typography.bodyBold,
    fontSize: 13,
    flex: 1,
  },
});
