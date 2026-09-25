import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Navigation, X, ShieldAlert } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';

interface Props {
  onDriverFound: () => void;
  onCancel: () => void;
}

export const FindingDriverScreen: React.FC<Props> = ({ onDriverFound, onCancel }) => {
  const [progress, setProgress] = useState<number>(30);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          onDriverFound();
          return 100;
        }
        return prev + 15;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.container}>
      {/* Radar Map Layer */}
      <MapPlaceholder
        showRadar
        showRoute={false}
        pickupText="MG Road Metro Station"
        dropText="Indiranagar 100 Feet Rd"
      />

      {/* Bottom Sheet Card */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        <View style={styles.searchingHeader}>
          <View style={styles.radarIconWrap}>
            <Navigation size={24} color={colors.accent} />
          </View>
          <View>
            <Text style={styles.searchingTitle}>Searching for your driver...</Text>
            <Text style={styles.searchingSub}>Connecting to nearby Comfort Sedans</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
        </View>

        <View style={styles.locationPillRow}>
          <Text style={styles.pickupLabel}>Pickup:</Text>
          <Text style={styles.pickupVal} numberOfLines={1}>MG Road Metro Entrance Gate 2</Text>
        </View>

        <Button
          title="Cancel Search"
          onPress={onCancel}
          variant="outline"
          size="medium"
          style={styles.cancelBtn}
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
    padding: 24,
    ...shadows.modal,
    gap: 16,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  searchingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  radarIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  searchingTitle: {
    ...typography.cardTitle,
    fontSize: 17,
  },
  searchingSub: {
    ...typography.meta,
    fontSize: 13,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  locationPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radii.md,
    gap: 6,
  },
  pickupLabel: {
    ...typography.metaBold,
    color: colors.textMuted,
  },
  pickupVal: {
    ...typography.bodyBold,
    fontSize: 13,
    flex: 1,
  },
  cancelBtn: {
    marginTop: 4,
  },
});
