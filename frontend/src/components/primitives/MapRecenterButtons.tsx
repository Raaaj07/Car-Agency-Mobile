/**
 * MapRecenterButtons — the floating "Locate driver" round button plus the
 * compact "Follow" toggle used on the live tracking maps.
 *
 * Presentational only: the screen owns the camera state. `bottomOffset` is the
 * measured bottom-sheet height so the buttons always sit just above it
 * (Android safe-area included in that measurement).
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Crosshair, Navigation } from 'lucide-react-native';
import { colors, radii, shadows } from '../../theme/theme';

interface Props {
  onLocate: () => void;
  followOn: boolean;
  onToggleFollow: () => void;
  /** Distance from the bottom edge — pass the bottom sheet's height. */
  bottomOffset: number;
}

export const MapRecenterButtons: React.FC<Props> = ({
  onLocate,
  followOn,
  onToggleFollow,
  bottomOffset,
}) => (
  <View style={[styles.wrap, { bottom: bottomOffset + 12 }]} pointerEvents="box-none">
    <TouchableOpacity
      style={[styles.followBtn, followOn && styles.followBtnOn]}
      onPress={onToggleFollow}
      accessibilityRole="switch"
      accessibilityState={{ checked: followOn }}
      accessibilityLabel="Keep map centred on the driver"
    >
      <Navigation size={14} color={followOn ? colors.textLight : colors.textNavy} />
      <Text style={[styles.followText, followOn && styles.followTextOn]}>Follow</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={styles.locateBtn}
      onPress={onLocate}
      accessibilityRole="button"
      accessibilityLabel="Locate driver"
    >
      <Crosshair size={22} color={colors.textNavy} />
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    alignItems: 'flex-end',
    gap: 10,
  },
  locateBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadows.card,
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  followBtnOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  followText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textNavy,
  },
  followTextOn: {
    color: colors.textLight,
  },
});
