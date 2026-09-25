import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Phone, MessageSquare, Star, Car, Shield, ArrowRight, KeyRound } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';

interface Props {
  onTrackDriver: () => void;
}

export const YouGotTheRideScreen: React.FC<Props> = ({ onTrackDriver }) => {
  return (
    <View style={styles.container}>
      {/* Map Background with Driver Pin */}
      <MapPlaceholder
        showDriverPin
        driverEta="3 MIN"
        pickupText="MG Road Metro Entrance Gate 2"
        dropText="Indiranagar 100 Feet Rd"
      />

      {/* Driver Matched Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.matchBanner}>
          <Text style={styles.matchBannerText}>🎉 You Got the Ride!</Text>
          <Text style={styles.matchSubText}>Driver arrives in 3 minutes</Text>
        </View>

        {/* Start OTP Code Box */}
        <View style={styles.otpBox}>
          <View style={styles.otpLeft}>
            <KeyRound size={20} color={colors.primary} />
            <Text style={styles.otpLabel}>START RIDE OTP</Text>
          </View>
          <Text style={styles.otpValue}>4892</Text>
        </View>

        {/* Driver Details Card */}
        <Card style={styles.driverCard}>
          <View style={styles.driverRow}>
            <Avatar name="Rajesh Kumar" rating={4.9} size={54} online />

            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>Rajesh Kumar</Text>
              <Text style={styles.vehicleName}>White Maruti Dzire</Text>
              <View style={styles.plateBadge}>
                <Text style={styles.plateText}>KA 05 MN 4821</Text>
              </View>
            </View>

            <View style={styles.actionsCol}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.successLight }]}>
                <Phone size={18} color={colors.success} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#EEF2FF' }]}>
                <MessageSquare size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </Card>

        <Button
          title="Track Driver En Route"
          onPress={onTrackDriver}
          variant="primary"
          size="large"
          rightIcon={<ArrowRight size={20} color="#FFFFFF" />}
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
  matchBanner: {
    backgroundColor: colors.accentLight,
    padding: 12,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  matchBannerText: {
    ...typography.cardTitle,
    fontSize: 18,
    color: colors.accent,
  },
  matchSubText: {
    ...typography.metaBold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  otpBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(33, 27, 78, 0.15)',
  },
  otpLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  otpLabel: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.primary,
    letterSpacing: 1,
  },
  otpValue: {
    ...typography.heading,
    fontSize: 22,
    color: colors.primary,
    letterSpacing: 4,
  },
  driverCard: {
    padding: 16,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  vehicleName: {
    ...typography.meta,
    fontSize: 12,
    marginBottom: 4,
  },
  plateBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
  },
  plateText: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  actionsCol: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
