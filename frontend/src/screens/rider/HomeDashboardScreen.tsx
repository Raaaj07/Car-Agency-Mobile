import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { ArrowLeft, Search, Locate, AlertCircle, AlertTriangle, X } from 'lucide-react-native';

import { colors, radii, shadows } from '../../theme/theme';
import { RealMapView, LatLng } from '../../components/primitives/RealMapView';
import { reverseGeocode, GeocodeResult } from '../../api/mapbox';
import { API_URL } from '../../api/client';
import { driversApi, NearbyDriver } from '../../api/drivers';
import { useRideStore } from '../../store/rideStore';
import { usePlacesStore, useMergedRecents, useVisiblePlaces } from '../../store/placesStore';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { useAddressSearch } from '../../hooks/useAddressSearch';
import { PlaceItem } from '../../api/places';
import { haversineKm, formatDistance } from '../../utils/distance';
import { useTabBarSpace } from '../../components/primitives/BottomTabBar';

import { PickupPin } from '../../components/home/PickupPin';
import { PlaceSearchRow } from '../../components/home/PlaceSearchRow';
import { QuickPickTile } from '../../components/home/QuickPickTile';
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

// Nearest-place photo tiles shown before the "Search for other places" tile.
const GRID_PLACE_COUNT = 5;
// Frequently-visited rows shown on the home sheet.
const FREQUENT_ROW_COUNT = 3;
// Recent-place rows shown directly under the search box.
const RECENT_ROW_COUNT = 3;

export const HomeDashboardScreen: React.FC<Props> = ({ onSearchPress, onSelectVehicle }) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const tabBarSpace = useTabBarSpace();

  // ── Store state ─────────────────────────────────────────────────────────────
  const pickupAddress = useRideStore((state) => state.pickupAddress);
  const pickupCoords = useRideStore((state) => state.pickupCoords);
  const setPickup = useRideStore((state) => state.setPickup);
  const setDropoff = useRideStore((state) => state.setDropoff);

  const { nearby, frequent, error, fetchAll, suggestionsCoords, lastFetchedAt } = usePlacesStore();
  const toggleSaved = usePlacesStore((state) => state.toggleSaved);
  const recordSearch = usePlacesStore((state) => state.recordSearch);
  // Rider's own recent searches + trips: shown only while typing in search.
  const mergedRecent = useMergedRecents();
  // Nearest places are photo tiles: a place without a (working) photo is not
  // rendered at all.
  const visibleNearby = useVisiblePlaces(nearby);
  // Frequently visited: this rider's most-repeated drop-offs (their ride history).
  const frequentRows = useMemo(() => frequent.slice(0, FREQUENT_ROW_COUNT), [frequent]);
  // Recent places go straight under the search box. A place already listed
  // under "Frequently visited" is not repeated there.
  const recentRows = useMemo(() => {
    const key = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const frequentKeys = new Set(frequentRows.map(key));
    return mergedRecent.filter((p) => !frequentKeys.has(key(p))).slice(0, RECENT_ROW_COUNT);
  }, [mergedRecent, frequentRows]);

  // ── GPS Hook ────────────────────────────────────────────────────────────────
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
  const initialGpsAppliedRef = useRef(false);
  const loadedWithoutLocationRef = useRef(false);

  // ── Bottom Sheet Snap Points ────────────────────────────────────────────────
  // Header: grab handle + the pill-shaped search field.
  const HEADER_HEIGHT = 80;
  // Room for the recent rows (~62 each) shown under the search box. Anything
  // below (frequent, nearest) is reached by scrolling the sheet.
  const recentRowsHeight = recentRows.length * 62;

  const defaultVisibleHeight = Math.max(
    windowHeight * 0.5,
    HEADER_HEIGHT + tabBarSpace + recentRowsHeight + 60,
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

  const mapBottomInset = windowHeight - snapY.default;

  const [currentSnap, setCurrentSnap] = useState<SnapPoint>('default');

  // Pickup address pill + recenter button fade out when the sheet expands.
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

  // ── Inline "Where do you want to go?" search ───────────────────────────────
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
          setPickup('Pin dropped', `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, { lat: latitude, lng: longitude });
        })
        .finally(() => setIsResolvingAddress(false));
    }
  }, [gpsCoords, pickupCoords, setPickup]);

  // ── Location-based suggestions ──────────────────────────────────────────────
  useEffect(() => {
    // Wait for the location request to settle (permission prompt / GPS fix).
    if (locationStatus === 'loading') return;
    if (locationStatus !== 'granted' || !gpsCoords) {
      // No real position (permission denied / GPS off). Never invent one: load
      // what does not need a location (frequently visited, saved, promos) once.
      if (!loadedWithoutLocationRef.current) {
        loadedWithoutLocationRef.current = true;
        void fetchAll(undefined, true);
      }
      return;
    }
    loadedWithoutLocationRef.current = false;
    const here = { lat: gpsCoords.latitude, lng: gpsCoords.longitude };
    if (suggestionsCoords && haversineKm(suggestionsCoords, here) < SUGGESTION_REFRESH_KM) return;
    void fetchAll(here, true);
  }, [gpsCoords, locationStatus, suggestionsCoords, fetchAll]);

  // ── Driver Polling ──────────────────────────────────────────────────────────
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

  // ── Map Center Idle ─────────────────────────────────────────────────────────
  const handleCenterIdle = useCallback(
    (newCenter: LatLng, meta?: { isUserInteraction: boolean }) => {
      if (!initialGpsAppliedRef.current || !meta?.isUserInteraction) {
        setIsResolvingAddress(false);
        return;
      }

      if (pickupCoords) {
        const dLat = Math.abs(newCenter.lat - pickupCoords.lat);
        const dLng = Math.abs(newCenter.lng - pickupCoords.lng);
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

  const handleRecenter = useCallback(() => {
    if (gpsCoords) {
      setRecenterNonce((prev) => prev + 1);
      refreshLocation();
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

  // Distance printed under a typed suggestion's pin, measured from the pickup.
  const distanceFromPickup = useCallback(
    (lat: number, lng: number): string | undefined =>
      pickupCoords ? (formatDistance(haversineKm(pickupCoords, { lat, lng })) ?? undefined) : undefined,
    [pickupCoords],
  );

  // Nearest places (already nearest-first from the server), photo tiles only.
  const gridPlaces = useMemo(() => visibleNearby.slice(0, GRID_PLACE_COUNT), [visibleNearby]);

  const gridWidth = windowWidth - 40;
  const gridGap = 10;
  const tileWidth = Math.floor((gridWidth - gridGap * 2) / 3);

  const hasLiveLocation = locationStatus === 'granted';
  const loadedOnce = lastFetchedAt !== null;
  // Nothing to show under "Nearest places": say why instead of a silent blank.
  const noNearest = loadedOnce && gridPlaces.length === 0 && !error;

  const showApiWarning = API_URL.includes('10.0.2.2') && Platform.OS !== 'android' && !__DEV__;

  return (
    <View style={styles.container}>
      {/* ── 1. Map ───────────────────────────────────────────────────────────── */}
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

        <PickupPin
          bottomInset={mapBottomInset}
          addressText={isResolvingAddress ? 'Locating...' : 'Pickup Point'}
          lifted={isResolvingAddress}
        />
      </View>

      {showApiWarning && (
        <View style={[styles.apiWarningBanner, { top: insets.top + 12 }]}>
          <AlertTriangle size={14} color="#FFFFFF" />
          <Text style={styles.apiWarningText}>API URL fallback active ({API_URL})</Text>
        </View>
      )}

      {/* ── 2. Pickup address pill + recenter, floating just above the sheet ──── */}
      <Animated.View
        style={[styles.pickupRow, { bottom: defaultVisibleHeight + 12, opacity: pillOpacity }]}
        pointerEvents={currentSnap === 'expanded' ? 'none' : 'box-none'}
      >
        <TouchableOpacity
          style={styles.topPill}
          onPress={() => onSearchPress('pickup')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Change pickup location"
        >
          <View style={styles.greenRing}>
            <View style={styles.greenRingInner} />
          </View>
          <Text style={styles.topPillText} numberOfLines={1}>
            {isResolvingAddress ? 'Locating your pickup...' : pickupAddress || 'Set pickup location'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        style={[styles.recenterContainer, { bottom: defaultVisibleHeight + 64, opacity: pillOpacity }]}
        pointerEvents={currentSnap === 'expanded' ? 'none' : 'box-none'}
      >
        {locationStatus === 'denied' && (
          <TouchableOpacity style={styles.enableLocationBtn} onPress={openSettings} activeOpacity={0.8}>
            <AlertCircle size={14} color="#FFFFFF" />
            <Text style={styles.enableLocationText}>Enable location</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.recenterBtn} onPress={handleRecenter} activeOpacity={0.8}>
          <Locate size={20} color={colors.primary} />
        </TouchableOpacity>
      </Animated.View>

      {/* ── 3. Bottom sheet ──────────────────────────────────────────────────── */}
      <BottomSheet
        snapY={snapY}
        initialSnap="default"
        onSnapChange={handleSnapChange}
        headerPanEnabled={!searchActive}
        snapRequest={snapRequest}
        onHardwareBack={handleHardwareBack}
        header={
          <View style={styles.searchCard}>
            {searchActive ? (
              <View style={styles.searchField}>
                <TouchableOpacity
                  onPress={closeInlineSearch}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close search"
                >
                  <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={handleSearchTextChange}
                  placeholder="Where do you want to go?"
                  placeholderTextColor="#6B7280"
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
                    <X size={18} color="#6B7280" />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.searchField}
                onPress={openInlineSearch}
                activeOpacity={0.9}
                accessibilityRole="search"
                accessibilityLabel="Search destination. Where do you want to go?"
              >
                <Search size={22} color={colors.textPrimary} />
                <Text style={styles.searchCTAText}>Where do you want to go?</Text>
              </TouchableOpacity>
            )}
          </View>
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
                mergedRecent.map((item, idx) => (
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
                ))
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
                {searchSuggestions.map((result, idx) => (
                  <PlaceSearchRow
                    key={`${result.lat}-${result.lng}-${idx}`}
                    variant="search"
                    title={result.address.split(',')[0]}
                    subtitle={result.address.split(',').slice(1).join(',').trim() || result.address}
                    distanceText={distanceFromPickup(result.lat, result.lng)}
                    onPress={() => handlePickSuggestion(result)}
                    isLast={idx === searchSuggestions.length - 1}
                  />
                ))}
              </>
            )}
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarSpace + 16 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Recent places: flat rows straight under the search pill */}
            {recentRows.map((item, idx) => (
              <PlaceSearchRow
                key={item.id}
                variant="recent"
                title={item.title}
                subtitle={item.subtitle}
                onPress={() => handleSelectPlace(item)}
                onToggleHeart={() => toggleSaved(item)}
                heartActive={!!item.saved}
                isLast={idx === recentRows.length - 1 && frequentRows.length === 0}
              />
            ))}

            {/* Frequently visited: this rider's most-repeated drop-offs */}
            {frequentRows.length > 0 && (
              <View>
                <Text style={recentRows.length > 0 ? styles.sectionTitle : styles.sectionTitleFirst}>
                  Frequently visited
                </Text>
                {frequentRows.map((item, idx) => (
                  <PlaceSearchRow
                    key={item.id}
                    variant="recent"
                    title={item.title}
                    subtitle={
                      item.visitCount ? `${item.visitCount} trips · ${item.subtitle}` : item.subtitle
                    }
                    onPress={() => handleSelectPlace(item)}
                    onToggleHeart={() => toggleSaved(item)}
                    heartActive={!!item.saved}
                    isLast={idx === frequentRows.length - 1}
                  />
                ))}
              </View>
            )}

            {/* Nearest places — live, 3-column photo grid, last tile opens search */}
            <Text
              style={
                frequentRows.length > 0 || recentRows.length > 0
                  ? styles.sectionTitle
                  : styles.sectionTitleFirst
              }
            >
              Nearest places
            </Text>
            <View style={styles.grid}>
              {gridPlaces.map((item) => (
                <QuickPickTile
                  key={item.id}
                  type="place"
                  place={item}
                  onPress={() => handleSelectPlace(item)}
                  tileWidth={tileWidth}
                />
              ))}
              <QuickPickTile type="search_more" onPress={openInlineSearch} tileWidth={tileWidth} />
            </View>

            {noNearest && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {hasLiveLocation ? 'No places found near you yet' : 'Turn on location to see places near you'}
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

            {!!error && (
              <TouchableOpacity
                style={styles.errorRetryRow}
                onPress={() =>
                  fetchAll(gpsCoords ? { lat: gpsCoords.latitude, lng: gpsCoords.longitude } : undefined, true)
                }
                activeOpacity={0.7}
              >
                <Text style={styles.errorRetryText}>{error} Tap to retry</Text>
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

  // ── Pickup address pill (sits on the map, right above the sheet) ───────────
  pickupRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 15,
  },
  topPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 11,
    ...shadows.card,
  },
  greenRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greenRingInner: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  topPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },

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

  // ── Recenter ────────────────────────────────────────────────────────────────
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

  // ── Search pill (sheet header) ──────────────────────────────────────────────
  searchCard: {
    backgroundColor: '#FFFFFF',
    paddingBottom: 6,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E9F0',
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 13,
    ...shadows.card,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    padding: 0,
  },
  searchCTAText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },

  // ── Body ────────────────────────────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 6,
    backgroundColor: '#FFFFFF',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  sectionTitleFirst: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 22,
  },

  // ── Inline search states ────────────────────────────────────────────────────
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  searchHint: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    paddingVertical: 18,
  },

  errorRetryRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptyCard: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: '#E5E9F0',
    padding: 16,
    marginTop: 16,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
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
