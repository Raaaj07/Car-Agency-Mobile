import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Navigation, ShieldAlert, Share2, MapPin, Gauge, CheckCircle } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';

interface Props {
  onCompleteTrip: () => void;
  onEmergencyPress?: () => void;
}

export const TripProgressScreen: React.FC<Props> = ({ onCompleteTrip, onEmergencyPress }) => {
  return (
    <View style={styles.container}>
      <MapPlaceholder
        showRoute
        showDriverPin
        driverEta="12 MIN"
        pickupText="On Trip to Indiranagar"
        dropText="Indiranagar 100 Feet Rd"
      />

      {/* Top Floating Speed & ETA Bar */}
      <View style={styles.topInfoBar}>
        <View style={styles.etaCol}>
          <Text style={styles.etaTitle}>12 MINS</Text>
          <Text style={styles.etaSub}>Estimated Arrival: 5:45 PM</Text>
        </View>

        <View style={styles.speedPill}>
          <Gauge size={16} color={colors.accent} />
          <Text style={styles.speedText}>42 km/h</Text>
        </View>
      </View>

      {/* Safety SOS Quick Button */}
      <TouchableOpacity style={styles.sosFloatingBtn} onPress={onEmergencyPress}>
        <ShieldAlert size={22} color="#FFFFFF" />
        <Text style={styles.sosText}>SOS</Text>
      </TouchableOpacity>

      {/* Bottom Sheet Navigation Card */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        <View style={styles.destHeader}>
          <MapPin size={22} color={colors.danger} />
          <View style={styles.destInfo}>
            <Text style={styles.destLabel}>HEADING TO</Text>
            <Text style={styles.destName}>Indiranagar 100 Feet Road, Hub 4</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionChip}>
            <Share2 size={16} color={colors.primary} />
            <Text style={styles.chipText}>Share Trip</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionChip}>
            <ShieldAlert size={16} color={colors.primary} />
            <Text style={styles.chipText}>Safety Toolkit</Text>
          </TouchableOpacity>
        </View>

        <Button
          title="Complete Trip (Simulate)"
          onPress={onCompleteTrip}
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
    backgroundColor: colors.background,
  },
  topInfoBar: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.card,
    ...shadows.card,
  },
  etaCol: {},
  etaTitle: {
    ...typography.heading,
    fontSize: 20,
    color: colors.accent,
  },
  etaSub: {
    ...typography.meta,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  speedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    gap: 6,
  },
  speedText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  sosFloatingBtn: {
    position: 'absolute',
    top: 90,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    gap: 4,
    ...shadows.button,
  },
  sosText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
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
  destHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  destInfo: {
    flex: 1,
  },
  destLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
  },
  destName: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    paddingVertical: 10,
    borderRadius: radii.button,
    gap: 6,
  },
  chipText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.primary,
  },
});
