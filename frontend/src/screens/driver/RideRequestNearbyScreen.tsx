import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MapPin, Navigation, Clock, User, Star, X, Check } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';

interface Props {
  onAccept: () => void;
  onDecline: () => void;
}

export const RideRequestNearbyScreen: React.FC<Props> = ({ onAccept, onDecline }) => {
  const [seconds, setSeconds] = useState<number>(15);

  useEffect(() => {
    if (seconds > 0) {
      const timer = setInterval(() => setSeconds((prev) => prev - 1), 1000);
      return () => clearInterval(timer);
    } else {
      onDecline();
    }
  }, [seconds]);

  return (
    <View style={styles.container}>
      <MapPlaceholder
        showRoute
        pickupText="MG Road Metro Entrance Gate 2"
        dropText="Indiranagar 100 Feet Rd"
      />

      {/* Countdown Ring Header */}
      <View style={styles.timerHeader}>
        <View style={styles.timerCircle}>
          <Text style={styles.timerText}>{seconds}</Text>
        </View>
        <Text style={styles.timerSubText}>seconds to accept request</Text>
      </View>

      {/* Incoming Request Bottom Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.fareRow}>
          <View>
            <Text style={styles.estLabel}>ESTIMATED FARE</Text>
            <Text style={styles.fareAmount}>₹240.00</Text>
          </View>

          <View style={styles.categoryPill}>
            <Text style={styles.categoryText}>Comfort Sedan</Text>
          </View>
        </View>

        {/* Rider Profile Row */}
        <Card style={styles.riderCard}>
          <View style={styles.riderRow}>
            <Avatar name="Alex Morgan" rating={4.8} size={48} />
            <View style={styles.riderMeta}>
              <Text style={styles.riderName}>Alex Morgan</Text>
              <Text style={styles.riderSub}>4.8 ★ (120+ rides)</Text>
            </View>
          </View>
        </Card>

        {/* Pickup & Drop Details */}
        <View style={styles.routeDetails}>
          <View style={styles.pointRow}>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointLabel}>PICKUP (1.2 km away • 4 mins drive)</Text>
              <Text style={styles.pointVal}>MG Road Metro Entrance Gate 2</Text>
            </View>
          </View>

          <View style={styles.routeLine} />

          <View style={styles.pointRow}>
            <View style={[styles.dot, { backgroundColor: colors.danger }]} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointLabel}>DROP OFF (8.4 km trip)</Text>
              <Text style={styles.pointVal}>Indiranagar 100 Feet Road, Hub 4</Text>
            </View>
          </View>
        </View>

        {/* Accept / Decline Action Buttons */}
        <View style={styles.btnRow}>
          <Button
            title="Decline"
            onPress={onDecline}
            variant="danger"
            size="large"
            style={styles.declineBtn}
            leftIcon={<X size={20} color="#FFFFFF" />}
          />
          <Button
            title="Accept Ride"
            onPress={onAccept}
            variant="success"
            size="large"
            style={styles.acceptBtn}
            leftIcon={<Check size={20} color="#FFFFFF" />}
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
  timerHeader: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 10,
    ...shadows.card,
  },
  timerCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  timerSubText: {
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
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  estLabel: {
    ...typography.metaBold,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  fareAmount: {
    ...typography.heading,
    fontSize: 30,
    color: colors.accent,
  },
  categoryPill: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  categoryText: {
    ...typography.metaBold,
    color: colors.primary,
  },
  riderCard: {
    padding: 14,
  },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  riderMeta: {
    flex: 1,
  },
  riderName: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  riderSub: {
    ...typography.meta,
    fontSize: 12,
  },
  routeDetails: {
    backgroundColor: '#F8FAFC',
    padding: 14,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pointTextWrap: {
    flex: 1,
  },
  pointLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
  },
  pointVal: {
    ...typography.bodyBold,
    fontSize: 13,
  },
  routeLine: {
    width: 2,
    height: 18,
    backgroundColor: colors.border,
    marginLeft: 4,
    marginVertical: 4,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  declineBtn: {
    flex: 1,
  },
  acceptBtn: {
    flex: 2,
  },
});
