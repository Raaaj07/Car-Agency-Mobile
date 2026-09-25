import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { ArrowLeft, MapPin, Home, Briefcase, Clock, Navigation, ArrowUpDown, Star } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';

interface DestinationItem {
  id: string;
  title: string;
  subtitle: string;
  distance: string;
  icon: 'clock' | 'home' | 'work' | 'star';
}

const recentPlaces: DestinationItem[] = [
  {
    id: '1',
    title: 'Indiranagar Metro Station',
    subtitle: '100 Feet Rd, Indiranagar, Bengaluru',
    distance: '3.4 km',
    icon: 'clock',
  },
  {
    id: '2',
    title: 'Koramangala Sony World Signal',
    subtitle: '80 Feet Rd, 4th Block, Koramangala',
    distance: '5.8 km',
    icon: 'clock',
  },
  {
    id: '3',
    title: 'Kempegowda International Airport (BLR)',
    subtitle: 'Devanahalli, Bengaluru, Karnataka',
    distance: '38.2 km',
    icon: 'clock',
  },
];

interface Props {
  onBack: () => void;
  onSelectDestination: (place: DestinationItem) => void;
}

export const DestinationSearchScreen: React.FC<Props> = ({ onBack, onSelectDestination }) => {
  const [pickup, setPickup] = useState<string>('Current Location - MG Road');
  const [dropoff, setDropoff] = useState<string>('');

  return (
    <View style={styles.container}>
      {/* Search Header Panel */}
      <View style={styles.headerPanel}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <ArrowLeft size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Select Destination</Text>
        </View>

        <View style={styles.inputsCard}>
          <View style={styles.dotsColumn}>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
            <View style={styles.connectorLine} />
            <View style={[styles.dot, { backgroundColor: colors.danger }]} />
          </View>

          <View style={styles.inputsColumn}>
            <View style={styles.inputBox}>
              <Text style={styles.inputLabel}>PICKUP</Text>
              <Text style={styles.inputText} numberOfLines={1}>{pickup}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.inputBox}>
              <Text style={styles.inputLabel}>DROP OFF</Text>
              <Text style={[styles.inputText, !dropoff && styles.placeholderText]} numberOfLines={1}>
                {dropoff || 'Search destination...'}
              </Text>
            </View>
          </View>

          <TouchableOpacity style={styles.swapBtn}>
            <ArrowUpDown size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Saved Locations Shortcut Row */}
        <View style={styles.savedRow}>
          <TouchableOpacity
            style={styles.savedChip}
            onPress={() =>
              onSelectDestination({
                id: 'home',
                title: 'Home',
                subtitle: 'HSR Layout Sector 1',
                distance: '4.2 km',
                icon: 'home',
              })
            }
          >
            <View style={[styles.savedIcon, { backgroundColor: '#EEF2FF' }]}>
              <Home size={18} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.savedTitle}>Home</Text>
              <Text style={styles.savedSub}>HSR Layout</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.savedChip}
            onPress={() =>
              onSelectDestination({
                id: 'work',
                title: 'Work',
                subtitle: 'Manyata Tech Park',
                distance: '12.5 km',
                icon: 'work',
              })
            }
          >
            <View style={[styles.savedIcon, { backgroundColor: colors.accentLight }]}>
              <Briefcase size={18} color={colors.accent} />
            </View>
            <View>
              <Text style={styles.savedTitle}>Work</Text>
              <Text style={styles.savedSub}>Manyata Park</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Recent Search Locations List */}
        <Text style={styles.sectionHeader}>RECENT DESTINATIONS</Text>

        <View style={styles.list}>
          {recentPlaces.map((item) => (
            <Card key={item.id} style={styles.placeCard} onPress={() => onSelectDestination(item)}>
              <View style={styles.placeRow}>
                <View style={styles.clockIconWrap}>
                  <Clock size={20} color={colors.textSecondary} />
                </View>
                <View style={styles.placeTextWrap}>
                  <Text style={styles.placeTitle}>{item.title}</Text>
                  <Text style={styles.placeSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                </View>
                <Text style={styles.distText}>{item.distance}</Text>
              </View>
            </Card>
          ))}
        </View>

        {/* Set Pin on Map Button */}
        <TouchableOpacity style={styles.mapPinBar} onPress={() => onSelectDestination(recentPlaces[0])}>
          <Navigation size={20} color={colors.primary} />
          <Text style={styles.mapPinText}>Set location on map</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerPanel: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...shadows.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    ...typography.subheading,
    fontSize: 18,
  },
  inputsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: radii.card,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  dotsColumn: {
    alignItems: 'center',
    marginRight: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  connectorLine: {
    width: 2,
    height: 24,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  inputsColumn: {
    flex: 1,
  },
  inputBox: {
    justifyContent: 'center',
  },
  inputLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  inputText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  placeholderText: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 6,
  },
  swapBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: 8,
  },
  scrollContent: {
    padding: 20,
  },
  savedRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  savedChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#EEECF2',
    gap: 10,
    ...shadows.card,
  },
  savedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedTitle: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  savedSub: {
    ...typography.meta,
    fontSize: 11,
  },
  sectionHeader: {
    ...typography.metaBold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 12,
  },
  list: {
    gap: 10,
    marginBottom: 20,
  },
  placeCard: {
    padding: 14,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clockIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  placeTextWrap: {
    flex: 1,
  },
  placeTitle: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  placeSubtitle: {
    ...typography.meta,
    fontSize: 12,
  },
  distText: {
    ...typography.metaBold,
    fontSize: 12,
    color: colors.primary,
    marginLeft: 8,
  },
  mapPinBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.primary,
    gap: 8,
  },
  mapPinText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
});
