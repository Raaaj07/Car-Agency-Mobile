import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Keyboard } from 'react-native';
import { ArrowLeft, MapPin, Home, Briefcase, Clock, Navigation, ArrowUpDown, Plus } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { useRideStore } from '../../store/rideStore';
import { usePlacesStore } from '../../store/placesStore';
import { searchAddress, GeocodeResult } from '../../api/mapbox';

export interface DestinationSelection {
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
}

interface DestinationItem {
  id: string;
  title: string;
  subtitle: string;
  distance: string;
  lat: number;
  lng: number;
}

interface Props {
  onBack: () => void;
  onSelectDestination: (place: DestinationSelection) => void;
  /** Pre-focus 'pickup' or 'dropoff' field on mount. Defaults to 'dropoff'. */
  focus?: 'pickup' | 'dropoff';
}

type ActiveField = 'pickup' | 'dropoff' | null;

export const DestinationSearchScreen: React.FC<Props> = ({ onBack, onSelectDestination, focus }) => {
  const storePickupAddress = useRideStore((state) => state.pickupAddress);
  const setPickup = useRideStore((state) => state.setPickup);
  const setDropoff = useRideStore((state) => state.setDropoff);

  const recentPlaces = usePlacesStore((state) => state.recent);
  const savedPlaces = usePlacesStore((state) => state.saved);
  const homePlace = savedPlaces.find((s) => s.label === 'home');
  const workPlace = savedPlaces.find((s) => s.label === 'work');

  const [pickupText, setPickupText] = useState(storePickupAddress || '');
  const [dropoffText, setDropoffText] = useState('');
  const [activeField, setActiveField] = useState<ActiveField>(focus ?? 'dropoff');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchAddress(query);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const handlePickupChange = (text: string) => {
    setPickupText(text);
    setActiveField('pickup');
    runSearch(text);
  };

  const handleDropoffChange = (text: string) => {
    setDropoffText(text);
    setActiveField('dropoff');
    runSearch(text);
  };

  const applySuggestion = (result: GeocodeResult) => {
    const shortTitle = result.address.split(',')[0];
    if (activeField === 'pickup') {
      setPickupText(result.address);
      setPickup(shortTitle, result.address, { lat: result.lat, lng: result.lng });
      setSuggestions([]);
      setActiveField(null);
      Keyboard.dismiss();
      return;
    }
    // Picking a dropoff is the terminal action on this screen, same as
    // tapping a preset below — move straight on to vehicle selection.
    setDropoffText(result.address);
    setDropoff(shortTitle, result.address, { lat: result.lat, lng: result.lng });
    Keyboard.dismiss();
    onSelectDestination({ title: shortTitle, subtitle: result.address, lat: result.lat, lng: result.lng });
  };

  const selectPreset = (item: DestinationItem) => {
    setDropoff(item.title, item.subtitle, { lat: item.lat, lng: item.lng });
    onSelectDestination({ title: item.title, subtitle: item.subtitle, lat: item.lat, lng: item.lng });
  };

  const handleSwap = () => {
    const prevPickupText = pickupText;
    const prevPickupCoords = useRideStore.getState().pickupCoords;
    const prevDropoffCoords = useRideStore.getState().dropoffCoords;

    setPickupText(dropoffText);
    setDropoffText(prevPickupText);

    if (prevDropoffCoords) {
      setPickup(dropoffText.split(',')[0] || dropoffText, dropoffText, prevDropoffCoords);
    }
    if (prevPickupCoords) {
      setDropoff(prevPickupText.split(',')[0] || prevPickupText, prevPickupText, prevPickupCoords);
    }
  };

  const showSuggestionsPanel = activeField !== null;

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
              <TextInput
                value={pickupText}
                onChangeText={handlePickupChange}
                onFocus={() => setActiveField('pickup')}
                placeholder="Current location"
                placeholderTextColor={colors.textMuted}
                style={styles.inputField}
                returnKeyType="search"
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.inputBox}>
              <Text style={styles.inputLabel}>DROP OFF</Text>
              <TextInput
                value={dropoffText}
                onChangeText={handleDropoffChange}
                onFocus={() => setActiveField('dropoff')}
                placeholder="Search destination..."
                placeholderTextColor={colors.textMuted}
                style={styles.inputField}
                autoFocus
                returnKeyType="search"
              />
            </View>
          </View>

          <TouchableOpacity style={styles.swapBtn} onPress={handleSwap}>
            <ArrowUpDown size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {showSuggestionsPanel ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionHeader}>
            {activeField === 'pickup' ? 'PICKUP SUGGESTIONS' : 'DROP-OFF SUGGESTIONS'}
          </Text>

          {isSearching && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          {!isSearching && suggestions.length === 0 && (activeField === 'pickup' ? pickupText : dropoffText).trim().length >= 3 && (
            <Text style={styles.emptyText}>No matching places found</Text>
          )}

          {!isSearching && suggestions.length === 0 && (activeField === 'pickup' ? pickupText : dropoffText).trim().length < 3 && (
            <Text style={styles.emptyText}>Keep typing to search…</Text>
          )}

          <View style={styles.list}>
            {suggestions.map((result, index) => (
              <Card key={`${result.lat}-${result.lng}-${index}`} style={styles.placeCard} onPress={() => applySuggestion(result)}>
                <View style={styles.placeRow}>
                  <View style={styles.clockIconWrap}>
                    <MapPin size={20} color={colors.textSecondary} />
                  </View>
                  <View style={styles.placeTextWrap}>
                    <Text style={styles.placeTitle} numberOfLines={1}>{result.address.split(',')[0]}</Text>
                    <Text style={styles.placeSubtitle} numberOfLines={1}>{result.address}</Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Saved Locations Shortcut Row */}
          <View style={styles.savedRow}>
            {homePlace ? (
              <TouchableOpacity
                style={styles.savedChip}
                onPress={() =>
                  selectPreset({ id: homePlace.id, title: homePlace.title, subtitle: homePlace.address, distance: '', lat: homePlace.lat, lng: homePlace.lng })
                }
              >
                <View style={[styles.savedIcon, { backgroundColor: '#EEF2FF' }]}>
                  <Home size={18} color={colors.primary} />
                </View>
                <View>
                  <Text style={styles.savedTitle}>Home</Text>
                  <Text style={styles.savedSub} numberOfLines={1}>{homePlace.address.split(',')[0]}</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.savedChip, styles.addChip]} onPress={() => setActiveField('dropoff')}>
                <View style={[styles.savedIcon, { backgroundColor: '#EEF2FF' }]}>
                  <Plus size={18} color={colors.primary} />
                </View>
                <Text style={styles.savedTitle}>Add Home</Text>
              </TouchableOpacity>
            )}

            {workPlace ? (
              <TouchableOpacity
                style={styles.savedChip}
                onPress={() =>
                  selectPreset({ id: workPlace.id, title: workPlace.title, subtitle: workPlace.address, distance: '', lat: workPlace.lat, lng: workPlace.lng })
                }
              >
                <View style={[styles.savedIcon, { backgroundColor: colors.accentLight }]}>
                  <Briefcase size={18} color={colors.accent} />
                </View>
                <View>
                  <Text style={styles.savedTitle}>Work</Text>
                  <Text style={styles.savedSub} numberOfLines={1}>{workPlace.address.split(',')[0]}</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.savedChip, styles.addChip]} onPress={() => setActiveField('dropoff')}>
                <View style={[styles.savedIcon, { backgroundColor: colors.accentLight }]}>
                  <Plus size={18} color={colors.accent} />
                </View>
                <Text style={styles.savedTitle}>Add Work</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Recent Search Locations List */}
          {recentPlaces.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>RECENT DESTINATIONS</Text>
              <View style={styles.list}>
                {recentPlaces.map((item) => (
                  <Card
                    key={item.id}
                    style={styles.placeCard}
                    onPress={() => selectPreset({ id: item.id, title: item.title, subtitle: item.subtitle, distance: '', lat: item.lat, lng: item.lng })}
                  >
                    <View style={styles.placeRow}>
                      <View style={styles.clockIconWrap}>
                        <Clock size={20} color={colors.textSecondary} />
                      </View>
                      <View style={styles.placeTextWrap}>
                        <Text style={styles.placeTitle}>{item.title}</Text>
                        <Text style={styles.placeSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            </>
          )}

          {/* Set Pin on Map Button */}
          <TouchableOpacity style={styles.mapPinBar} onPress={() => setActiveField('dropoff')}>
            <Navigation size={20} color={colors.primary} />
            <Text style={styles.mapPinText}>Set location on map</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerPanel: {
    backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24, ...shadows.card,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headerTitle: { ...typography.subheading, fontSize: 18 },
  inputsCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC',
    borderRadius: radii.card, padding: 14, borderWidth: 1, borderColor: '#E5E7EB',
  },
  dotsColumn: { alignItems: 'center', marginRight: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  connectorLine: { width: 2, height: 24, backgroundColor: colors.border, marginVertical: 4 },
  inputsColumn: { flex: 1 },
  inputBox: { justifyContent: 'center' },
  inputLabel: { ...typography.metaBold, fontSize: 9, color: colors.textMuted, letterSpacing: 1 },
  inputField: {
    ...typography.bodyBold, fontSize: 14, color: colors.textPrimary,
    padding: 0, margin: 0, height: 22,
  },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 6 },
  swapBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, marginLeft: 8,
  },
  scrollContent: { padding: 20 },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },
  emptyText: { ...typography.meta, textAlign: 'center', paddingVertical: 16 },
  savedRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  savedChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    padding: 12, borderRadius: radii.lg, borderWidth: 1, borderColor: '#EEECF2', gap: 10, ...shadows.card,
  },
  savedIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  savedTitle: { ...typography.bodyBold, fontSize: 14 },
  savedSub: { ...typography.meta, fontSize: 11 },
  addChip: { borderStyle: 'dashed' },
  sectionHeader: { ...typography.metaBold, fontSize: 11, letterSpacing: 1, color: colors.textMuted, marginBottom: 12 },
  list: { gap: 10, marginBottom: 20 },
  placeCard: { padding: 14 },
  placeRow: { flexDirection: 'row', alignItems: 'center' },
  clockIconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  placeTextWrap: { flex: 1 },
  placeTitle: { ...typography.bodyBold, fontSize: 14 },
  placeSubtitle: { ...typography.meta, fontSize: 12 },
  distText: { ...typography.metaBold, fontSize: 12, color: colors.primary, marginLeft: 8 },
  mapPinBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
    padding: 14, borderRadius: radii.button, borderWidth: 1.5, borderColor: colors.primary, gap: 8,
  },
  mapPinText: { ...typography.bodyBold, color: colors.primary },
});