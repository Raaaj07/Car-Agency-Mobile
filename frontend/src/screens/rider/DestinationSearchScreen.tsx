import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Home, Briefcase, Navigation, ArrowUpDown, Plus } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { useRideStore } from '../../store/rideStore';
import { useMergedRecents, usePlacesStore } from '../../store/placesStore';
import { GeocodeResult } from '../../api/mapbox';
import { useAddressSearch } from '../../hooks/useAddressSearch';
import { PlaceSearchRow } from '../../components/home/PlaceSearchRow';

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

  // Same merged list the home sheet shows: local searches first, then ride
  // history — one "recently visited" source for both surfaces.
  const recentPlaces = useMergedRecents();
  const savedPlaces = usePlacesStore((state) => state.saved);
  const recordSearch = usePlacesStore((state) => state.recordSearch);
  const toggleSaved = usePlacesStore((state) => state.toggleSaved);
  const homePlace = savedPlaces.find((s) => s.label === 'home');
  const workPlace = savedPlaces.find((s) => s.label === 'work');

  const [pickupText, setPickupText] = useState(storePickupAddress || '');
  const [dropoffText, setDropoffText] = useState('');
  const [activeField, setActiveField] = useState<ActiveField>(focus ?? 'dropoff');
  // True after the rider tried to pick a destination while the pickup box holds
  // text they typed but never chose from the suggestions.
  const [pickupHint, setPickupHint] = useState(false);
  // True once the rider has typed in the pickup box and not yet chosen a suggestion.
  const [pickupEdited, setPickupEdited] = useState(false);
  const { suggestions, isSearching, runSearch, resetSearch } = useAddressSearch();
  const insets = useSafeAreaInsets();

  // The booking uses the pickup held in the ride store, not the text box. If the
  // rider edited the box and never picked a suggestion, the screen would show one
  // place and the driver would be sent to another - so stop and ask them to choose.
  // Only typing counts as an edit: a pickup that merely arrived later (GPS) is fine.
  const pickupConfirmed = (): boolean => {
    if (!pickupEdited) return true;
    setPickupHint(true);
    setActiveField('pickup');
    return false;
  };

  const handlePickupChange = (text: string) => {
    setPickupText(text);
    setPickupEdited(true);
    setPickupHint(false);
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
      setPickupEdited(false);
      setPickupHint(false);
      resetSearch();
      setActiveField(null);
      Keyboard.dismiss();
      return;
    }
    if (!pickupConfirmed()) return;
    // Picking a dropoff is the terminal action on this screen, same as
    // tapping a preset below — move straight on to vehicle selection.
    setDropoffText(result.address);
    setDropoff(shortTitle, result.address, { lat: result.lat, lng: result.lng });
    // Remember it for this rider — shows up on home + here (merged recents).
    recordSearch({
      id: `search-${result.lat.toFixed(4)},${result.lng.toFixed(4)}`,
      title: shortTitle,
      subtitle: result.address,
      lat: result.lat,
      lng: result.lng,
      imageUrl: null,
    });
    resetSearch();
    Keyboard.dismiss();
    onSelectDestination({ title: shortTitle, subtitle: result.address, lat: result.lat, lng: result.lng });
  };

  const selectPreset = (item: DestinationItem) => {
    if (!pickupConfirmed()) return;
    setDropoff(item.title, item.subtitle, { lat: item.lat, lng: item.lng });
    // Bumps the place to the top of the shared per-user recents list.
    recordSearch({
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      lat: item.lat,
      lng: item.lng,
      imageUrl: null,
    });
    onSelectDestination({ title: item.title, subtitle: item.subtitle, lat: item.lat, lng: item.lng });
  };

  const handleSwap = () => {
    const prevPickupText = pickupText;
    const prevPickupCoords = useRideStore.getState().pickupCoords;
    const prevDropoffCoords = useRideStore.getState().dropoffCoords;
    // Swap only when BOTH ends are real chosen places. With a blank or typed-only
    // drop-off it used to blank the pickup box while the store kept the old pickup.
    if (!prevPickupCoords || !prevDropoffCoords || !dropoffText.trim() || !prevPickupText.trim()) return;

    setPickupText(dropoffText);
    setDropoffText(prevPickupText);
    setPickupEdited(false);
    setPickupHint(false);

    if (prevDropoffCoords) {
      setPickup(dropoffText.split(',')[0] || dropoffText, dropoffText, prevDropoffCoords);
    }
    if (prevPickupCoords) {
      setDropoff(prevPickupText.split(',')[0] || prevPickupText, prevPickupText, prevPickupCoords);
    }
  };

  const showSuggestionsPanel = activeField !== null;
  // Live query for the focused field.
  const activeQuery = (activeField === 'pickup' ? pickupText : dropoffText).trim();
  // Suggestions only once there's something to match against. With a fresh
  // drop-off field the saved/recents browse panel shows instead — previously
  // recents were unreachable here (activeField only ever became null after a
  // pickup suggestion was picked).
  const showSuggestionList = activeField === 'pickup' || activeQuery.length >= 3;

  // Saved shortcuts + recents + map pin — the "browse" state of this screen.
  const browsePanel = (
    <>
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

      {/* Recent Search Locations List — same merged list as the home sheet */}
      {recentPlaces.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>RECENT DESTINATIONS</Text>
          <View style={styles.rowsCard}>
            {recentPlaces.map((item, idx) => (
              <PlaceSearchRow
                key={item.id}
                variant="recent"
                title={item.title}
                subtitle={item.subtitle}
                onPress={() => selectPreset({ id: item.id, title: item.title, subtitle: item.subtitle, distance: '', lat: item.lat, lng: item.lng })}
                onToggleHeart={() => toggleSaved(item)}
                heartActive={!!item.saved}
                isLast={idx === recentPlaces.length - 1}
              />
            ))}
          </View>
        </>
      )}

      {/* Set Pin on Map Button */}
      <TouchableOpacity style={styles.mapPinBar} onPress={() => setActiveField('dropoff')}>
        <Navigation size={20} color={colors.primary} />
        <Text style={styles.mapPinText}>Set location on map</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <View style={styles.container}>
      {/* Search Header Panel */}
      <View style={[styles.headerPanel, { paddingTop: 16 + insets.top }]}>
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
                autoFocus={focus === 'pickup'}
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
                // The drop-off box takes focus unless the caller asked for the pickup box
                // (Services does): two autoFocus fields would let this one win.
                autoFocus={focus !== 'pickup'}
                returnKeyType="search"
              />
            </View>
          </View>

          <TouchableOpacity style={styles.swapBtn} onPress={handleSwap} accessibilityRole="button" accessibilityLabel="Swap pickup and drop-off">
            <ArrowUpDown size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
        {pickupHint ? (
          <Text style={styles.hintText}>Choose your pickup from the suggestions first, then pick a destination.</Text>
        ) : null}
      </View>

      {showSuggestionsPanel ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 20 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {showSuggestionList ? (
            <>
              <Text style={styles.sectionHeader}>
                {activeField === 'pickup' ? 'PICKUP SUGGESTIONS' : 'DROP-OFF SUGGESTIONS'}
              </Text>

              {isSearching && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              )}

              {!isSearching && suggestions.length === 0 && activeQuery.length >= 3 && (
                <Text style={styles.emptyText}>No matching places found</Text>
              )}

              {!isSearching && suggestions.length === 0 && activeQuery.length < 3 && (
                <Text style={styles.emptyText}>Keep typing to search…</Text>
              )}

              {suggestions.length > 0 && (
                <View style={styles.rowsCard}>
                  {suggestions.map((result, index) => (
                    <PlaceSearchRow
                      key={`${result.lat}-${result.lng}-${index}`}
                      variant="search"
                      title={result.address.split(',')[0]}
                      subtitle={result.address}
                      onPress={() => applySuggestion(result)}
                      isLast={index === suggestions.length - 1}
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            browsePanel
          )}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 20 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {browsePanel}
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
  hintText: { ...typography.meta, fontSize: 12, color: colors.danger, marginTop: 10 },
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
  // One white surface per list; PlaceSearchRow rows divide with hairlines.
  rowsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: '#EEECF2',
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 20,
    ...shadows.card,
  },
  distText: { ...typography.metaBold, fontSize: 12, color: colors.primary, marginLeft: 8 },
  mapPinBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
    padding: 14, borderRadius: radii.button, borderWidth: 1.5, borderColor: colors.primary, gap: 8,
  },
  mapPinText: { ...typography.bodyBold, color: colors.primary },
});