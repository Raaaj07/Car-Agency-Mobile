import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Search, Locate, ChevronRight, AlertCircle, AlertTriangle, Home, Briefcase, Clock, X } from 'lucide-react-native';

import { colors, radii, shadows, typography } from '../../theme/theme';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { reverseGeocode, GeocodeResult } from '../../api/mapbox';
import { API_URL } from '../../api/client';
import { driversApi, NearbyDriver } from '../../api/drivers';
import { useRideStore } from '../../store/rideStore';
import { usePlacesStore, useMergedRecents, useVisiblePlaces } from '../../store/placesStore';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { useAddressSearch } from '../../hooks/useAddressSearch';
import { PlaceItem } from '../../api/places';
import { haversineKm } from '../../utils/distance';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';

import { PickupPin } from '../../components/home/PickupPin';
import { PlaceSearchRow } from '../../components/home/PlaceSearchRow';
import { QuickPickTile } from '../../components/home/QuickPickTile';
import { PopularPlaceCard } from '../../components/home/PopularPlaceCard';
import { PLACE_CARD_SIZES } from '../../components/home/PlaceCard';
import { ServiceTile, VEHICLE_SERVICES } from '../../components/home/ServiceTile';
import { PromoCarousel } from '../../components/home/PromoCarousel';
import { CityHighlightCard } from '../../components/home/CityHighlightCard';
import { BottomSheet, SnapPoint, SnapPointsConfig } from '../../components/home/BottomSheet';

interface Props {
  onSearchPress: (focus?: 'pickup' | 'dropoff') => void;
  onSelectVehicle: () => void;
  onBellPress?: () => void;
  onExploreServices?: () => void;
}

let pointSeq = 0;

// Re-fetch "Near You" / "Popular" once the rider has moved this far (km) from
// where the current suggestions were computed.
const SUGGESTION_REFRESH_KM = 1;

// Space between photo cards in the horizontal place rails (and the snap step).
const PLACE_CARD_GAP = 12;

export const HomeDashboardScreen: React.FC<Props> = ({
  onSearchPress,
  onSelectVehicle,
  onExploreServices,
}) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const tabBarSpace = useTabBarSpace();

  // ── Store state ─────────────────────────────────────────────────────────────
  const pickupAddress = useRideStore((state) => state.pickupAddress);
  const pickupCoords = useRideStore((state) => state.pickupCoords);
  const setPickup = useRideStore((state) => state.setPickup);
  const setDropoff = useRideStore((state) => state.setDropoff);
  const setPreferredVehicle = useRideStore((state) => state.setPreferredVehicle);

  const {
    saved,
    nearby,
    quickPicks,
    popular,
    cityHighlights,
    promos,
    error,
    fetchAll,
    suggestionsCoords,
    lastFetchedAt,
  } = usePlacesStore();
  const toggleSaved = usePlacesStore((state) => state.toggleSaved);
  const recordSearch = usePlacesStore((state) => state.recordSearch);
  // Single "recently visited" list shared with the destination picker:
  // this session's searches first, then ride-history drop-offs from the server.
  const mergedRecent = useMergedRecents();
  // Place cards are photo cards: a place the API returned without a photo (or
  // whose photo failed to load) is not rendered at all.
  const visibleNearby = useVisiblePlaces(nearby);
  const visiblePopular = useVisiblePlaces(popular);
  const visibleHighlights = useVisiblePlaces(cityHighlights);
  const visibleQuickPicks = useVisiblePlaces(quickPicks);

  // ── GPS Hook (Phase 0d & A4.5) ──────────────────────────────────────────────
  const {
    coords: gpsCoords,
    status: locationStatus,
    openSettings,
    refresh: refreshLocation,
  } = useCurrentLocation();

  // Map state
  const [recenterNonce, setRecenterNonce] = useState(1);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const [nearbyDriverDots, setNearbyDriverDots] = useState<LatLng[]>([]);
  const [driverCountsByType, setDriverCountsByType] = useState<Record<string, number>>({});
  const initialGpsAppliedRef = useRef(false);
  // Set once we have loaded the non-location data (recents/saved/promos) for a
  // rider whose GPS never produced a real fix.
  const loadedWithoutLocationRef = useRef(false);

  // ── Bottom Sheet Snap Points (A1.1, A3.2, A3.3) ──────────────────────────────
  // Header height: handle (14) + search field (~54) = ~70px
  const HEADER_HEIGHT = 72;
  // Room for the "Recent places" header (30) + its first three rows (64 each).
  const recentRowsHeight = mergedRecent.length > 0 ? 30 + Math.min(mergedRecent.length, 3) * 64 : 0;

  const defaultVisibleHeight = Math.max(
    windowHeight * 0.48,
    HEADER_HEIGHT + tabBarSpace + recentRowsHeight + 40,
  );
  const collapsedVisibleHeight = HEADER_HEIGHT + tabBarSpace;
  const expandedTop = insets.top + 8;

  const snapY: SnapPointsConfig = useMemo(
    () => ({
      expanded: expandedTop,
      default: windowHeight - defaultVisibleHeight,
      collapsed: windowHeight - collapsedVisibleHeight,
    }),
    [windowHeight, defaultVisibleHeight, collapsedVisibleHeight, expandedTop],
  );

  // Computed single source of truth map bottom inset
  const mapBottomInset = windowHeight - snapY.default;

  const [currentSnap, setCurrentSnap] = useState<SnapPoint>('default');

  // Animated top address pill opacity (fades out when sheet expands).
  // Lazy useState instead of useRef(...).current — reading a fresh ref's
  // .current during render trips react-hooks/refs; created once either way.
  const [pillOpacity] = useState(() => new Animated.Value(1));

  const handleSnapChange = useCallback(
    (snap: SnapPoint) => {
      setCurrentSnap(snap);
      Animated.timing(pillOpacity, {
        toValue: snap === 'expanded' ? 0 : 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    },
    [pillOpacity],
  );

  // ── Inline "Where do you want to go?" search (Rapido-style) ──────────────────
  // Tapping the CTA swaps the sheet header for a real focused input; the sheet
  // expands and the body lists live suggestions (or recents while the query
  // is empty). Exiting = header back arrow, Android back, or picking a place.
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [snapRequest, setSnapRequest] = useState<{ point: SnapPoint; nonce: number } | null>(null);
  const snapNonceRef = useRef(0);
  const {
    suggestions: searchSuggestions,
    isSearching: isSearchingPlaces,
    runSearch,
    resetSearch,
  } = useAddressSearch();

  const requestSnap = useCallback((point: SnapPoint) => {
    snapNonceRef.current += 1;
    setSnapRequest({ point, nonce: snapNonceRef.current });
  }, []);

  const openInlineSearch = useCallback(() => {
    setSearchActive(true);
    setSearchQuery('');
    requestSnap('expanded');
  }, [requestSnap]);

  const closeInlineSearch = useCallback(() => {
    setSearchActive(false);
    setSearchQuery('');
    resetSearch();
    Keyboard.dismiss();
    requestSnap('default');
  }, [requestSnap, resetSearch]);

  const clearSearchInput = useCallback(() => {
    setSearchQuery('');
    resetSearch();
  }, [resetSearch]);

  const handleSearchTextChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      runSearch(text);
    },
    [runSearch],
  );

  // Android hardware back closes inline search BEFORE collapsing the sheet.
  const handleHardwareBack = useCallback(() => {
    if (!searchActive) return false;
    closeInlineSearch();
    return true;
  }, [searchActive, closeInlineSearch]);

  // ── Initial GPS sync (runs once on first GPS fix / pull) ──────────────────────
  useEffect(() => {
    if (!gpsCoords || initialGpsAppliedRef.current) return;
    initialGpsAppliedRef.current = true;
    const { latitude, longitude } = gpsCoords;
    if (!pickupCoords) {
      // Async boundary — sync setState directly in the effect trips
      // react-hooks/set-state-in-effect. Lands before reverseGeocode's
      // .finally clears it (microtasks flush before any network promise).
      Promise.resolve().then(() => setIsResolvingAddress(true));
      reverseGeocode(latitude, longitude)
        .then((addr) => {
          if (addr) {
            const shortTitle = addr.split(',')[0].trim() || 'Current location';
            setPickup(shortTitle, addr, { lat: latitude, lng: longitude });
          } else {
            setPickup('Pin dropped', `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, { lat: latitude, lng: longitude });
          }
        })
        .catch(() => {
          setPickup('Salem', 'Salem, Tamil Nadu', { lat: latitude, lng: longitude });
        })
        .finally(() => setIsResolvingAddress(false));
    }
  }, [gpsCoords, pickupCoords, setPickup]);

  // ── Location-based suggestions (Near You + Popular) ─────────────────────────────────────
  // Keyed on the rider's REAL (GPS) position, not the draggable pickup pin:
  // fetch on the first fix, then again whenever they have moved more than
  // SUGGESTION_REFRESH_KM from where the current lists were computed (the
  // GPS hook re-reads on screen focus and on the locate button). The server
  // returns both lists nearest-first with a distance on every card.
  useEffect(() => {
    if (!gpsCoords) return;
    // Wait for the location request to settle (permission prompt / GPS fix).
    if (locationStatus === 'loading') return;
    if (locationStatus !== 'granted') {
      // Denied / GPS timeout: gpsCoords is only the Salem PLACEHOLDER, not where
      // the rider is — never build "Near You" from it. Still load everything
      // that does not need a position (recents, saved, promos) once.
      if (!loadedWithoutLocationRef.current) {
        loadedWithoutLocationRef.current = true;
        void fetchAll(undefined, true);
      }
      return;
    }
    const here = { lat: gpsCoords.latitude, lng: gpsCoords.longitude };
    if (suggestionsCoords && haversineKm(suggestionsCoords, here) < SUGGESTION_REFRESH_KM) return;
    void fetchAll(here, true);
  }, [gpsCoords, locationStatus, suggestionsCoords, fetchAll]);

  // ── Driver Polling (A4.3, C7 capped at 15) ──────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      if (currentSnap === 'expanded') return;
      let active = true;

      const poll = async () => {
        if (!pickupCoords) return;
        try {
          const list: NearbyDriver[] = await driversApi.nearby(pickupCoords.lat, pickupCoords.lng);
          if (!active) return;
          setNearbyDriverDots(list.map((d) => ({ lat: d.lat, lng: d.lng })));
          const counts: Record<string, number> = {};
          list.forEach((d) => {
            counts[d.vehicleType] = (counts[d.vehicleType] || 0) + 1;
          });
          setDriverCountsByType(counts);
        } catch {
          // silent ignore
        }
      };

      void poll();
      const interval = setInterval(poll, 15_000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [pickupCoords, currentSnap]),
  );

  // ── Map Center Idle (A1.1, A4.1) ──────────────────────────────────────────────
  const handleCenterIdle = useCallback(
    (newCenter: LatLng, meta?: { isUserInteraction: boolean }) => {
      // Ignore map center events before initial GPS fix is applied or if not user interaction.
      // Always clear a stale "locating" flag so the pill can never stick.
      if (!initialGpsAppliedRef.current || !meta?.isUserInteraction) {
        setIsResolvingAddress(false);
        return;
      }

      if (pickupCoords) {
        const dLat = Math.abs(newCenter.lat - pickupCoords.lat);
        const dLng = Math.abs(newCenter.lng - pickupCoords.lng);
        // Skip under 30m — and clear any gesture-start "locating" state
        // since no resolve will follow.
        if (dLat < 0.0003 && dLng < 0.0003) {
          setIsResolvingAddress(false);
          return;
        }
      }

      const seq = ++pointSeq;
      setIsResolvingAddress(true);
      setTimeout(() => {
        if (seq !== pointSeq) return;
        reverseGeocode(newCenter.lat, newCenter.lng)
          .then((addr) => {
            if (seq !== pointSeq) return;
            if (addr) {
              const shortTitle = addr.split(',')[0].trim() || 'Pickup Point';
              setPickup(shortTitle, addr, newCenter);
            } else {
              setPickup('Pin dropped', `${newCenter.lat.toFixed(4)}, ${newCenter.lng.toFixed(4)}`, newCenter);
            }
          })
          .catch(() => {})
          .finally(() => {
            if (seq === pointSeq) setIsResolvingAddress(false);
          });
      }, 600);
    },
    [pickupCoords, setPickup],
  );

  // Actions
  const handleSelectPlace = useCallback(
    (place: PlaceItem) => {
      // Remember the pick for this rider — it merges into the recents shown
      // here AND on the Select Destination screen (recordSearch dedupes).
      recordSearch(place);
      setDropoff(place.title, place.subtitle, { lat: place.lat, lng: place.lng });
      if (searchActive) closeInlineSearch();
      onSelectVehicle();
    },
    [recordSearch, setDropoff, searchActive, closeInlineSearch, onSelectVehicle],
  );

  const handlePickSuggestion = useCallback(
    (result: GeocodeResult) => {
      const shortTitle = result.address.split(',')[0].trim() || 'Pinned location';
      handleSelectPlace({
        id: `search-${result.lat.toFixed(4)},${result.lng.toFixed(4)}`,
        title: shortTitle,
        subtitle: result.address,
        lat: result.lat,
        lng: result.lng,
        imageUrl: null,
      });
    },
    [handleSelectPlace],
  );

  const handleSelectService = useCallback(
    (serviceId: string) => {
      setPreferredVehicle(serviceId);
      openInlineSearch();
    },
    [setPreferredVehicle, openInlineSearch],
  );

  const handleRecenter = useCallback(() => {
    if (gpsCoords) {
      setRecenterNonce((prev) => prev + 1);
      // Re-read the GPS too: if the rider has moved, Near You / Popular
      // re-fetch for the new spot (see the suggestions effect above).
      refreshLocation();
      // The recenter flight is programmatic (its idle events are ignored),
      // so resolve the GPS address directly — the pill must match the map.
      const seq = ++pointSeq;
      setIsResolvingAddress(true);
      reverseGeocode(gpsCoords.latitude, gpsCoords.longitude)
        .then((addr) => {
          if (seq !== pointSeq) return;
          if (addr) {
            const shortTitle = addr.split(',')[0].trim() || 'Current location';
            setPickup(shortTitle, addr, { lat: gpsCoords.latitude, lng: gpsCoords.longitude });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (seq === pointSeq) setIsResolvingAddress(false);
        });
    }
  }, [gpsCoords, setPickup, refreshLocation]);

  // Layout math for grid items
  const gridWidth = windowWidth - 40;
  const quickPickWidth = Math.floor((gridWidth - 24) / 3);

  const homeSaved = saved.find((s) => s.label === 'home');
  const workSaved = saved.find((s) => s.label === 'work');

  // ── Saved-place shortcut chips (header search card) ───────────────────────
  // Home + Work from placesStore.saved, plus the first 2 recent places.
  // Tapping a chip sets it as dropoff and goes to vehicle selection.
  // Empty → no chips row (no placeholder data).
  interface ChipItem {
    key: string;
    icon: 'home' | 'work' | 'recent';
    label: string;
    place: PlaceItem;
  }
  const chipItems: ChipItem[] = [];
  if (homeSaved) {
    chipItems.push({
      key: `saved-${homeSaved.id}`,
      icon: 'home',
      label: homeSaved.title || 'Home',
      place: {
        id: homeSaved.id,
        title: homeSaved.title,
        subtitle: homeSaved.address,
        lat: homeSaved.lat,
        lng: homeSaved.lng,
        imageUrl: null,
      },
    });
  }
  if (workSaved) {
    chipItems.push({
      key: `saved-${workSaved.id}`,
      icon: 'work',
      label: workSaved.title || 'Work',
      place: {
        id: workSaved.id,
        title: workSaved.title,
        subtitle: workSaved.address,
        lat: workSaved.lat,
        lng: workSaved.lng,
        imageUrl: null,
      },
    });
  }
  // Two freshest recents (local searches first, then ride history).
  mergedRecent.slice(0, 2).forEach((r) => {
    chipItems.push({ key: `recent-${r.id}`, icon: 'recent', label: r.title, place: r });
  });

  // Popular places: the nearest 8 (already nearest-first from the server).
  // Deliberately NOT de-duplicated against "Near You": a popular place that is
  // also close must still appear under Popular.
  const popularNearby = visiblePopular.slice(0, 10);
  const hasLiveLocation = locationStatus === 'granted';
  // Nothing to show for either list: say so (and why) instead of leaving a
  // silent blank. `lastFetchedAt` is set once a fetch has completed.
  const loadedOnce = lastFetchedAt !== null;
  const noSuggestions = loadedOnce && visibleNearby.length === 0 && popularNearby.length === 0 && visibleHighlights.length === 0 && !error;

  // Check emulator API_URL fallback diagnostic (A0.2)
  const showApiWarning =
    API_URL.includes('10.0.2.2') && Platform.OS !== 'android' && !__DEV__;

  return (
    <View style={styles.container}>
      {/* ── 1. Map Layer (Phase 3 & Part A) ─────────────────────────────────── */}
      <View style={styles.mapContainer}>
        <RealMapView
          mode="picker"
          pickup={pickupCoords}
          pickerPin={true}
          onCenterIdle={handleCenterIdle}
          onCenterGestureStart={() => setIsResolvingAddress(true)}
          bottomPadding={mapBottomInset}
          showUserLocation={locationStatus === 'granted'}
          recenterTo={
            gpsCoords
              ? { lat: gpsCoords.latitude, lng: gpsCoords.longitude, nonce: recenterNonce }
              : undefined
          }
          nearbyDrivers={nearbyDriverDots}
          pickupVisible={false}
        />

        {/* Center Pin Overlay aligned with mapBottomInset (A1) */}
        <PickupPin
          bottomInset={mapBottomInset}
          addressText={isResolvingAddress ? 'Locating...' : 'Pickup Point'}
          lifted={isResolvingAddress}
        />
      </View>

      {/* ── 2. Top Pickup Address Pill (A3.4) ───────────────────────────────── */}
      <Animated.View
        style={[
          styles.topPillContainer,
          { top: insets.top + 8, opacity: pillOpacity },
        ]}
        pointerEvents={currentSnap === 'expanded' ? 'none' : 'box-none'}
      >
        <TouchableOpacity
          style={styles.topPill}
          onPress={() => onSearchPress('pickup')}
          activeOpacity={0.85}
        >
          <View style={styles.greenDot} />
          <Text style={styles.topPillText} numberOfLines={1}>
            {isResolvingAddress
              ? 'Locating your pickup...'
              : pickupAddress || 'Set pickup location'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Diagnostic API_URL Banner (A0.2) */}
      {showApiWarning && (
        <View style={[styles.apiWarningBanner, { top: insets.top + 60 }]}>
          <AlertTriangle size={14} color="#FFFFFF" />
          <Text style={styles.apiWarningText}>API URL fallback active ({API_URL})</Text>
        </View>
      )}

      {/* ── 3. Floating Recenter Button (A2.3) ──────────────────────────────── */}
      <View style={[styles.recenterContainer, { bottom: defaultVisibleHeight + 16 }]}>
        {locationStatus === 'denied' && (
          <TouchableOpacity style={styles.enableLocationBtn} onPress={openSettings} activeOpacity={0.8}>
            <AlertCircle size={14} color="#FFFFFF" />
            <Text style={styles.enableLocationText}>Enable location</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.recenterBtn} onPress={handleRecenter} activeOpacity={0.8}>
          <Locate size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* ── 4. Bottom Sheet Container (A2, A3) ──────────────────────────────── */}
      <BottomSheet
        snapY={snapY}
        initialSnap="default"
        onSnapChange={handleSnapChange}
        headerPanEnabled={!searchActive}
        snapRequest={snapRequest}
        onHardwareBack={handleHardwareBack}
        header={
          searchActive ? (
            /* Inline input mode: a real focused field right on the home sheet. */
            <View style={styles.searchCard}>
              <View style={styles.searchField}>
                <TouchableOpacity
                  style={styles.searchBackBtn}
                  onPress={closeInlineSearch}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close search"
                >
                  <ArrowLeft size={20} color={colors.textPrimary} />
                </TouchableOpacity>
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={handleSearchTextChange}
                  placeholder="Where do you want to go?"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                  returnKeyType="search"
                  selectionColor={colors.primary}
                  accessibilityLabel="Where do you want to go?"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={clearSearchInput}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <X size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            /* Idle CTA, styled like an input field; tap switches it to the
               inline input above (no screen change). */
            <View style={styles.searchCard}>
              <TouchableOpacity
                style={styles.searchField}
                onPress={openInlineSearch}
                activeOpacity={0.9}
                accessibilityRole="search"
                accessibilityLabel="Search destination. Where do you want to go?"
              >
                <Search size={20} color={colors.primary} />
                <Text style={styles.searchCTAText}>Where do you want to go?</Text>
              </TouchableOpacity>
              {chipItems.length > 0 && (
                <View style={styles.savedChipRow}>
                  {chipItems.map((chip) => (
                    <TouchableOpacity
                      key={chip.key}
                      style={styles.savedChip}
                      onPress={() => handleSelectPlace(chip.place)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Go to ${chip.label}`}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      {chip.icon === 'home' ? (
                        <Home size={15} color={colors.primary} />
                      ) : chip.icon === 'work' ? (
                        <Briefcase size={15} color={colors.accent} />
                      ) : (
                        <Clock size={15} color={colors.textSecondary} />
                      )}
                      <Text style={styles.savedChipLabel} numberOfLines={1}>
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )
        }
      >
        {searchActive ? (
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarSpace + 16 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {searchQuery.trim().length < 3 ? (
              mergedRecent.length > 0 ? (
                <View style={styles.listCard}>
                  <Text style={styles.listHeader}>Recent places</Text>
                  {mergedRecent.map((item, idx) => (
                    <PlaceSearchRow
                      key={item.id}
                      variant="recent"
                      title={item.title}
                      subtitle={item.subtitle}
                      onPress={() => handleSelectPlace(item)}
                      onToggleHeart={() => toggleSaved(item)}
                      heartActive={!!item.saved}
                      isLast={idx === mergedRecent.length - 1}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.searchHint}>Start typing to search for a place</Text>
              )
            ) : (
              <>
                {isSearchingPlaces && (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                )}
                {!isSearchingPlaces && searchSuggestions.length === 0 && (
                  <Text style={styles.searchHint}>No matching places found</Text>
                )}
                {searchSuggestions.length > 0 && (
                  <View style={styles.listCard}>
                    {searchSuggestions.map((result, idx) => (
                      <PlaceSearchRow
                        key={`${result.lat}-${result.lng}-${idx}`}
                        variant="search"
                        title={result.address.split(',')[0]}
                        subtitle={result.address}
                        onPress={() => handlePickSuggestion(result)}
                        isLast={idx === searchSuggestions.length - 1}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarSpace + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Recently visited — directly under the search bar (was below Services) */}
          {mergedRecent.length > 0 && (
            <View style={styles.listCard}>
              <Text style={styles.listHeader}>Recent places</Text>
              {mergedRecent.slice(0, 3).map((item, idx) => (
                <PlaceSearchRow
                  key={item.id}
                  variant="recent"
                  title={item.title}
                  subtitle={item.subtitle}
                  onPress={() => handleSelectPlace(item)}
                  onToggleHeart={() => toggleSaved(item)}
                  heartActive={!!item.saved}
                  isLast={idx === Math.min(mergedRecent.length, 3) - 1}
                />
              ))}
            </View>
          )}

          {/* Services grid card */}
          <View style={styles.servicesCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Services</Text>
              {onExploreServices && (
                <TouchableOpacity
                  style={styles.viewAllBtn}
                  onPress={onExploreServices}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="View all services"
                >
                  <Text style={styles.viewAllText}>View All</Text>
                  <ChevronRight size={14} color={colors.accent} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.servicesGrid}>
              {VEHICLE_SERVICES.map((s) => {
                const count = driverCountsByType[s.id];
                const eta = count ? `${count} nearby` : s.defaultEta;
                return (
                  <ServiceTile
                    key={s.id}
                    service={s}
                    etaHint={eta}
                    onPress={handleSelectService}
                  />
                );
              })}
            </View>
          </View>

          {/* Promo banners directly under the services card */}
          {promos.length > 0 && (
            <View style={styles.promoSlot}>
              <PromoCarousel promos={promos} />
            </View>
          )}

          {/* Quick Picks Grid (3 columns wrapping) */}
          <View style={styles.section}>
            <View style={styles.grid}>
              {homeSaved ? (
                <QuickPickTile
                  type="home"
                  label={homeSaved.title || 'Home'}
                  subtitle={homeSaved.address}
                  onPress={() =>
                    handleSelectPlace({
                      id: homeSaved.id,
                      title: homeSaved.title,
                      subtitle: homeSaved.address,
                      lat: homeSaved.lat,
                      lng: homeSaved.lng,
                      imageUrl: null,
                    })
                  }
                  tileWidth={quickPickWidth}
                />
              ) : (
                <QuickPickTile
                  type="home"
                  label="Add Home"
                  onPress={openInlineSearch}
                  tileWidth={quickPickWidth}
                />
              )}

              {workSaved ? (
                <QuickPickTile
                  type="work"
                  label={workSaved.title || 'Work'}
                  subtitle={workSaved.address}
                  onPress={() =>
                    handleSelectPlace({
                      id: workSaved.id,
                      title: workSaved.title,
                      subtitle: workSaved.address,
                      lat: workSaved.lat,
                      lng: workSaved.lng,
                      imageUrl: null,
                    })
                  }
                  tileWidth={quickPickWidth}
                />
              ) : (
                <QuickPickTile
                  type="work"
                  label="Add Work"
                  onPress={openInlineSearch}
                  tileWidth={quickPickWidth}
                />
              )}

              {visibleQuickPicks.slice(0, 3).map((item) => (
                <QuickPickTile
                  key={item.id}
                  type="place"
                  place={item}
                  onPress={() => handleSelectPlace(item)}
                  tileWidth={quickPickWidth}
                />
              ))}

              <QuickPickTile
                type="search_more"
                onPress={openInlineSearch}
                tileWidth={quickPickWidth}
              />
            </View>
          </View>

          {/* Section: Near You (live, location-based, nearest first) */}
          {visibleNearby.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Near You</Text>
                <Text style={styles.sectionSubtitle}>
                  {hasLiveLocation ? 'Closest to your location' : 'Closest first'}
                </Text>
              </View>
              <FlatList
                data={visibleNearby}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={PLACE_CARD_SIZES.tall.width + PLACE_CARD_GAP}
                snapToAlignment="start"
                contentContainerStyle={styles.placeRail}
                renderItem={({ item }) => (
                  <PopularPlaceCard place={item} onPress={handleSelectPlace} />
                )}
              />
            </View>
          )}

          {/* Section: Popular places, nearest first */}
          {popularNearby.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  {hasLiveLocation ? 'Popular near you' : 'Popular Places'}
                </Text>
                <Text style={styles.sectionSubtitle}>Nearest first</Text>
              </View>
              <FlatList
                data={popularNearby}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={PLACE_CARD_SIZES.tall.width + PLACE_CARD_GAP}
                snapToAlignment="start"
                contentContainerStyle={styles.placeRail}
                renderItem={({ item }) => (
                  <PopularPlaceCard place={item} onPress={handleSelectPlace} />
                )}
              />
            </View>
          )}

          {/* Section: Explore Your City */}
          {visibleHighlights.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Explore Your City</Text>
              </View>
              <FlatList
                data={visibleHighlights}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={PLACE_CARD_SIZES.wide.width + PLACE_CARD_GAP}
                snapToAlignment="start"
                contentContainerStyle={styles.placeRail}
                renderItem={({ item }) => (
                  <CityHighlightCard highlight={item} onPress={handleSelectPlace} />
                )}
              />
            </View>
          )}

          {/* Empty state: tell the rider WHY there are no suggestions */}
          {noSuggestions && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {hasLiveLocation ? 'No places found near you yet' : 'Turn on location for places near you'}
              </Text>
              <Text style={styles.emptyBody}>
                {hasLiveLocation
                  ? 'We could not load nearby places right now. Check your connection and try again.'
                  : 'Allow location access to see the nearest and most popular places around you.'}
              </Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => {
                  if (hasLiveLocation && gpsCoords) {
                    void fetchAll({ lat: gpsCoords.latitude, lng: gpsCoords.longitude }, true);
                  } else {
                    openSettings();
                  }
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <Text style={styles.emptyBtnText}>{hasLiveLocation ? 'Refresh' : 'Enable location'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Error / Retry Fallback */}
          {!!error && (
            <TouchableOpacity
              style={styles.errorRetryRow}
              onPress={() => fetchAll(gpsCoords ? { lat: gpsCoords.latitude, lng: gpsCoords.longitude } : undefined, true)}
              activeOpacity={0.7}
            >
              <Text style={styles.errorRetryText}>
                {error} Tap to retry
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
        )}
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },

  // ── Top Pickup Address Pill (A3.4) ────────────────────────────────────────
  topPillContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 15,
  },
  topPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    ...shadows.card,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  topPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },

  // ── API Warning Banner ──────────────────────────────────────────────────
  apiWarningBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 15,
    backgroundColor: colors.warning,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  apiWarningText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },

  // ── Floating Recenter Row ─────────────────────────────────────────────────
  recenterContainer: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 15,
  },
  recenterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EEF2F7',
    ...shadows.card,
  },
  enableLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    ...shadows.card,
  },
  enableLocationText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Search card (sheet header) ───────────────────────────────────────────
  // Borderless container: the field below carries the input look, and the
  // whole block lines up edge-to-edge with the cards in the body (20 px).
  searchCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.lg,
    paddingBottom: 6,
  },
  // Shared by the idle CTA and the live inline TextInput (input-box look).
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  searchBackBtn: {
    marginRight: -2,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyBold,
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
  },
  searchCTAText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  savedChipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  savedChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  savedChipLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },

  // ── Scroll Content & Sections ──────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    backgroundColor: colors.background,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    ...typography.subheading,
    fontSize: 17,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },

  // Horizontal photo-card rails (Near You / Popular / Explore). The bottom
  // padding keeps the cards' shadow from being clipped by the list bounds.
  placeRail: {
    gap: PLACE_CARD_GAP,
    paddingBottom: 10,
    paddingRight: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  // ── Services grid card ───────────────────────────────────────────────────
  servicesCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
    ...shadows.card,
  },
  servicesGrid: {
    flexDirection: 'row',
    gap: 10,
  },

  // ── Promo slot (directly under the services card) ──────────────────────────
  promoSlot: {
    marginBottom: 16,
  },

  // ── Saved & recent places list card ────────────────────────────────────────
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 16,
    ...shadows.card,
  },
  listHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 2,
  },

  // ── Inline search states ─────────────────────────────────────────────────
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  searchHint: {
    ...typography.meta,
    textAlign: 'center',
    paddingVertical: 18,
  },

  errorRetryRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  errorRetryText: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
