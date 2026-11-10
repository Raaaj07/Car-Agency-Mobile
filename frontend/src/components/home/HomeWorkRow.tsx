import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Home, Briefcase, Plus } from 'lucide-react-native';
import { colors, radii, shadows, typography } from '../../theme/theme';
import { SavedPlace } from '../../api/places';
import { labelName, PlaceLabel } from '../../utils/savedPlaces';

interface HomeWorkRowProps {
  home?: SavedPlace;
  work?: SavedPlace;
  /** Tap: go to the saved place, or start adding it when it is not saved yet. */
  onPress: (label: PlaceLabel) => void;
  /** Press and hold a saved shortcut: change it. */
  onLongPress: (label: PlaceLabel) => void;
}

interface ChipProps {
  label: PlaceLabel;
  place?: SavedPlace;
  onPress: (label: PlaceLabel) => void;
  onLongPress: (label: PlaceLabel) => void;
}

const Chip: React.FC<ChipProps> = ({ label, place, onPress, onLongPress }) => {
  const isHome = label === 'home';
  const Icon = place ? (isHome ? Home : Briefcase) : Plus;
  const tint = isHome ? colors.primary : colors.accent;
  const name = labelName(label);

  return (
    <TouchableOpacity
      style={[styles.chip, !place && styles.addChip]}
      onPress={() => onPress(label)}
      onLongPress={place ? () => onLongPress(label) : undefined}
      delayLongPress={400}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={place ? `${name}: ${place.address}. Press and hold to change.` : `Add ${name}`}
    >
      <View style={[styles.icon, { backgroundColor: isHome ? '#EEF2FF' : colors.accentLight }]}>
        <Icon size={18} color={tint} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {place ? name : `Add ${name}`}
        </Text>
        {place ? (
          <Text style={styles.sub} numberOfLines={1}>
            {place.address.split(',')[0]}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

/**
 * The two Home / Work shortcuts under the search box on the rider home screen
 * (and in its inline search). A saved shortcut shows its place and starts a
 * booking to it; an empty one reads "Add Home" / "Add Work".
 */
export const HomeWorkRow: React.FC<HomeWorkRowProps> = memo(({ home, work, onPress, onLongPress }) => (
  <View style={styles.row}>
    <Chip label="home" place={home} onPress={onPress} onLongPress={onLongPress} />
    <Chip label="work" place={work} onPress={onPress} onLongPress={onLongPress} />
  </View>
));

HomeWorkRow.displayName = 'HomeWorkRow';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#EEECF2',
    ...shadows.card,
  },
  addChip: {
    borderStyle: 'dashed',
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  sub: {
    ...typography.meta,
    fontSize: 11,
  },
});
