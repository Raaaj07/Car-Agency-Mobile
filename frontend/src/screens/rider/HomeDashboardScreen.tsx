import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Image,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search,
  Bell,
  Phone,
  Clock,
  Heart,
  MapPin,
  MapPinned,
} from 'lucide-react-native';

import { NotificationBar } from '../../components/primitives/NotificationBar';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { RealMapView } from '../../components/primitives/RealMapView';
import { reverseGeocode } from '../../api/mapbox';
import { placeThumbUrl, placePhotoUrl } from '../../api/places';
import { ridesApi } from '../../api/rides';
import * as Location from 'expo-location';
import { useRideStore } from '../../store/rideStore';
import { useAuthStore } from '../../store/authStore';

interface Props {
  onSearchPress: () => void;
  onSelectVehicle: () => void;
  onBellPress?: () => void;
}

interface RecentLocation {
  address: string;
  lat: number;
  lng: number;
  sub: string;
}

// Layout constants for the fixed-map / scrolling-sheet transition.
const SHEET_OVERLAP = 14; // sheet starts this far up over the map (kept low so the search bar sits lower)
const PILL_HEIGHT = 36; // sticky current-location pill (compact)
const PILL_GAP = 10; // gap between pill bottom and sheet edge at rest

// Cinematic rotating border for the white current-location bar: brand
// accent → success → blue → navy → accent, so the loop seam matches.
const SPIN_COLORS = [colors.accent, colors.success, '#3B82F6', colors.primary, colors.accent] as const;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "Salem New Bus Stand, Angammal Colony, Salem…" → "Salem New Bus Stand" */
function shortName(address: string): string {
  const first = address.split(',')[0].trim();
  return first || address;
}

function subLine(loc: RecentLocation, pickup: { lat: number; lng: number } | null): string {
  const rest = loc.address.split(',').slice(1).join(',').trim();
  const km = pickup ? haversineKm(pickup, loc).toFixed(1) : null;
  if (rest && km) return `${rest} · ${km} km`;
  if (rest) return rest;
  if (km) return `${km} km away`;
  return 'Recent destination';
}

export const HomeDashboardScreen: React.FC<Props> = ({
  onSearchPress,
  onSelectVehicle,
  onBellPress,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const MAP_HEIGHT = Math.max(260, Math.min(Math.round(height * 0.42), 360));
  const CARD_W = Math.floor((width - 40 - 24) / 3);

  const pickupCoords = useRideStore((state) => state.pickupCoords);
  const pickupAddress = useRideStore((state) => state.pickupAddress);
  const user = useAuthStore((state) => state.user);
  const firstName = user?.name?.trim().split(' ')[0] || 'there';
  const [showWelcome, setShowWelcome] = useState(() => useAuthStore.getState().justLoggedIn);
  const [recents, setRecents] = useState<RecentLocation[]>([]);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [cardPhotos, setCardPhotos] = useState<Record<string, string | null>>({});

  // ── Scroll transition ──────────────────────────────────────────────
  // The map is a FIXED background; only the sheet scrolls over it. The
  // Pickup Point → white bar transition is SCROLL-DRIVEN: it starts with
  // the very first movement of the sheet and completes at FOCUS_AT,
  // shaped by a smoothstep curve (eased multi-point interpolation) so it
  // feels cinematic rather than scrubby. `focused` (threshold + hysteresis)
  // still triggers the camera fly, the pin fade and the border spin.
  const [scrollY] = useState(() => new Animated.Value(0));
  const [focused, setFocused] = useState(false);
  const [headerHits, setHeaderHits] = useState(true);

  const FOCUS_AT = Math.max(60, Math.round((MAP_HEIGHT - SHEET_OVERLAP) * 0.4));
  const RELEASE_AT = FOCUS_AT - 30;

  const pillBaseTop = MAP_HEIGHT - SHEET_OVERLAP - PILL_HEIGHT - PILL_GAP;
  const pillTravel = Math.max(pillBaseTop - (insets.top + 8), 1);
  const pillTranslateY = scrollY.interpolate({
    inputRange: [0, pillTravel],
    outputRange: [0, -pillTravel],
    extrapolate: 'clamp',
  });
  const headerOpacity = scrollY.interpolate({
    inputRange: [30, 80],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const annotationBaseTop = Math.round(MAP_HEIGHT / 2) - 56;
  // Where the annotation bar settles: just below the pinned sticky pill.
  const LIFT = insets.top + 52 - annotationBaseTop;

  // Scroll → morph progress, shaped like an ease-in-out (smoothstep):
  // gentle at the start of the scroll, quick through the middle, settling
  // at the end — pure scroll sync but never choppy.
  const EASE_K = [0, 0.12, 0.5, 0.88, 1];
  const morphInput = EASE_K.map((_, i) => Math.round((FOCUS_AT * i) / (EASE_K.length - 1)));
  const eased = (from: number, to: number) =>
    scrollY.interpolate({
      inputRange: morphInput,
      outputRange: EASE_K.map((k) => from + (to - from) * k),
      extrapolate: 'clamp',
    });

  const greenLift = eased(0, LIFT);
  const morphLift = eased(6, LIFT);
  const greenOpacity = eased(1, 0);
  const greenScale = eased(1, 0.9);
  const morphOpacity = eased(0, 1);
  const morphScale = eased(0.9, 1);
  // The sticky map pill VANISHES as the morph takes over (no duplicate
  // address displays) — gone exactly when `focused` flips on.
  const stickyOpacity = pickupCoords ? eased(1, 0) : 1;

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: true,
      listener: (e: any) => {
        const y = e.nativeEvent.contentOffset.y as number;
        // The fading header must not keep eating taps once invisible.
        // (Same-value setState calls bail out — no per-frame re-renders.)
        setHeaderHits(y < 70);
        // Half-scrolled? Focus the map on the current location (hysteresis).
        if (!useRideStore.getState().pickupCoords) return;
        setFocused((was) => {
          if (!was && y >= FOCUS_AT) return true;
          if (was && y < RELEASE_AT) return false;
          return was;
        });
      },
    },
  );

  // Rotating gradient border on the white current-location bar — spins
  // only while the bar is on screen.
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!focused) return undefined;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [focused, spin]);
  const spinRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Fly-to target for RealMapView: at half-scroll, center the current
  // location inside the visible strip (bottom padding = hidden area).
  const flyTo = useMemo(
    () =>
      focused && pickupCoords
        ? {
            lat: pickupCoords.lat,
            lng: pickupCoords.lng,
            zoom: 15.5,
            bottomPadding: SHEET_OVERLAP + FOCUS_AT,
          }
        : null,
    [focused, pickupCoords, FOCUS_AT],
  );

  useEffect(() => {
    // Consume the one-shot flag (set in the lazy initializer above).
    useAuthStore.getState().clearJustLoggedIn();
  }, []);

  // Get the user's real current location when the screen loads.
  useEffect(() => {
    let mounted = true;

    const getCurrentLocation = async () => {
      try {
        const { status } =
          await Location.requestForegroundPermissionsAsync();

        if (status !== 'granted') {
          return;
        }

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (!mounted) return;

        const { latitude, longitude } = loc.coords;
        const address = await reverseGeocode(latitude, longitude);
        if (!mounted) return;

        useRideStore.getState().setPickup(
          address,
          address,
          { lat: latitude, lng: longitude },
        );
      } catch {
        // Pickup pill falls back to a locating message.
      }
    };

    getCurrentLocation();

    return () => {
      mounted = false;
    };
  }, []);

  // Recent destinations from real ride history (unique drop-offs).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { items } = await ridesApi.list(1, 12, 'rider');
        if (!mounted) return;
        const seen = new Set<string>();
        const out: RecentLocation[] = [];
        for (const r of items) {
          const address = r.dropoff?.address;
          if (!address || seen.has(address)) continue;
          seen.add(address);
          out.push({
            address,
            lat: r.dropoff.lat,
            lng: r.dropoff.lng,
            sub: 'Recent destination',
          });
          if (out.length >= 5) break;
        }
        if (mounted) setRecents(out);
      } catch {
        // Section stays hidden when history can't load.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Google Places photos for the place cards: as soon as recents load we
  // ask Places for a real image of each place; cards show the static map
  // thumb immediately and swap in the photo when it arrives.
  useEffect(() => {
    if (recents.length === 0) return undefined;
    let mounted = true;
    recents.slice(0, 4).forEach((loc) => {
      void placePhotoUrl(loc.address).then((photo) => {
        if (!mounted || !photo) return;
        setCardPhotos((prev) => (prev[loc.address] === photo ? prev : { ...prev, [loc.address]: photo }));
      });
    });
    return () => {
      mounted = false;
    };
  }, [recents]);

  const listRecents = recents.slice(0, 3);
  const gridRecents = recents.slice(0, 4);

  const selectRecent = (loc: RecentLocation) => {
    useRideStore.getState().setDropoff(loc.address, loc.address, { lat: loc.lat, lng: loc.lng });
    onSelectVehicle();
  };

  const toggleFavorite = (address: string) => {
    setFavorites((prev) => ({ ...prev, [address]: !prev[address] }));
  };

  // Small map image of a recent place is intentionally NOT shown in the
  // top list — that stays a clean "recent" (clock) icon; photos live in
  // the place-card boxes below.

  return (
    <View style={styles.container}>
      {/* ── Fixed map background (never scrolls) ─────────────────────── */}
      <View style={[styles.mapLayer, { height: MAP_HEIGHT }]}>
        <RealMapView
          mode="picker"
          pickup={pickupCoords ?? undefined}
          interactive={false}
          pickupVisible={!focused}
          flyTo={flyTo}
        />

        {/* Pickup Point → white Current Location bar (scroll-driven morph) */}
        {pickupCoords ? (
          <>
            <Animated.View
              style={[
                styles.pillRow,
                {
                  top: annotationBaseTop,
                  opacity: greenOpacity,
                  transform: [{ translateY: greenLift }, { scale: greenScale }],
                },
              ]}
              pointerEvents="none"
            >
              <View style={styles.annoPill}>
                <Text style={styles.annoText}>Pickup Point</Text>
              </View>
            </Animated.View>

            <Animated.View
              style={[
                styles.pillRow,
                {
                  top: annotationBaseTop,
                  opacity: morphOpacity,
                  transform: [{ translateY: morphLift }, { scale: morphScale }],
                },
              ]}
              pointerEvents="none"
            >
              <View style={styles.morphPillWrap}>
                <View style={styles.morphPill}>
                  {/* Rotating cinematic border (the 2px padding ring) */}
                  <Animated.View
                    style={[styles.morphSpin, { transform: [{ rotate: spinRotate }] }]}
                  >
                    <LinearGradient
                      colors={SPIN_COLORS}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>
                  {/* White bar — address only, no "Current Location" title */}
                  <View style={styles.morphInner}>
                    <View style={styles.morphTarget}>
                      <View style={styles.morphTargetInner} />
                    </View>
                    <Text style={styles.morphAddress} numberOfLines={1}>
                      {pickupAddress || 'Locating your pickup…'}
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>

            <Animated.View
              style={[styles.pillRow, { top: annotationBaseTop + 36, opacity: greenOpacity }]}
              pointerEvents="none"
            >
              <View style={styles.pickupStem} />
            </Animated.View>
          </>
        ) : null}
      </View>

      {/* ── Only the sheet scrolls over the map ──────────────────────── */}
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={{ height: MAP_HEIGHT - SHEET_OVERLAP }} />

        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />

          {/* Where do you want to go? */}
          <TouchableOpacity style={styles.searchPill} onPress={onSearchPress} activeOpacity={0.9}>
            <Search size={22} color={colors.primary} />
            <View style={styles.searchTextWrap}>
              <View style={styles.searchUnderline}>
                <Text style={styles.searchText}>Where do you want to go?</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Recent locations */}
          {listRecents.length > 0 ? (
            <View style={styles.recentsList}>
              {listRecents.map((loc, i) => (
                <TouchableOpacity
                  key={loc.address}
                  style={[styles.recentRow, i < listRecents.length - 1 && styles.recentDivider]}
                  onPress={() => selectRecent(loc)}
                  activeOpacity={0.7}
                >
                  <Clock size={22} color={colors.textMuted} />
                  <View style={styles.recentTextWrap}>
                    <Text style={styles.recentName} numberOfLines={1}>
                      {shortName(loc.address)}
                    </Text>
                    <Text style={styles.recentSub} numberOfLines={1}>
                      {subLine(loc, pickupCoords ?? null)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => toggleFavorite(loc.address)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={0.6}
                  >
                    <Heart
                      size={22}
                      color={favorites[loc.address] ? colors.accent : colors.textMuted}
                      fill={favorites[loc.address] ? colors.accent : 'transparent'}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyHint}>
              Places you search for will show up here.
            </Text>
          )}

          {/* Place cards */}
          <View style={styles.grid}>
            {gridRecents.map((loc) => {
              // Google Places photo when available, else the static map thumb.
              const uri = cardPhotos[loc.address] ?? placeThumbUrl(loc.lat, loc.lng, CARD_W, 86);
              return (
                <TouchableOpacity
                  key={`card-${loc.address}`}
                  style={styles.placeCard}
                  onPress={() => selectRecent(loc)}
                  activeOpacity={0.85}
                >
                  {uri ? (
                    <Image source={{ uri }} style={styles.placeImg} />
                  ) : (
                    <View style={[styles.placeImg, styles.placeImgFallback]}>
                      <MapPin size={22} color={colors.textMuted} />
                    </View>
                  )}
                  <Text style={styles.placeLabel} numberOfLines={2}>
                    {shortName(loc.address)}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={styles.placeCard}
              onPress={onSearchPress}
              activeOpacity={0.85}
            >
              <View style={[styles.placeImg, styles.searchCardImg]}>
                <MapPinned size={26} color={colors.accent} />
              </View>
              <Text style={styles.placeLabel}>Search for other places</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.ScrollView>

      {/* ── Floating brand header (fades out as the sheet rises) ─────── */}
      <Animated.View
        style={[styles.mapHeader, { top: insets.top + 6, opacity: headerOpacity }]}
        pointerEvents={headerHits ? 'auto' : 'none'}
      >
        <View style={styles.brandPill}>
          <View style={styles.logoBadge}>
            <Phone size={14} color={colors.accent} />
          </View>
          <Text style={styles.brandText}>vazhi</Text>
        </View>
        <TouchableOpacity style={styles.bellBtn} onPress={onBellPress} activeOpacity={0.7}>
          <Bell size={18} color={colors.primary} />
        </TouchableOpacity>
      </Animated.View>

      {/* ── Sticky current-location pill (rides up, vanishes on morph) ─ */}
      <Animated.View
        style={[
          styles.locationPillWrap,
          { top: pillBaseTop, opacity: stickyOpacity, transform: [{ translateY: pillTranslateY }] },
        ]}
        pointerEvents={focused ? 'none' : 'box-none'}
      >
        <TouchableOpacity style={styles.locationPill} onPress={onSearchPress} activeOpacity={0.9}>
          <View style={styles.targetOuter}>
            <View style={styles.targetInner} />
          </View>
          <Text style={styles.locationText} numberOfLines={1}>
            {pickupAddress || 'Locating your pickup…'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      <NotificationBar
        visible={showWelcome}
        title={`Welcome back, ${firstName} 👋`}
        subtitle="Ready when you are"
        icon={<Bell size={18} color={colors.success} />}
        onDismiss={() => setShowWelcome(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },

  // ── Fixed map layer ────────────────────────────────────────────────
  mapLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#E8ECF3',
  },
  pillRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  annoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.success,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radii.pill,
    ...shadows.card,
  },
  annoText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pickupStem: {
    width: 3,
    height: 14,
    backgroundColor: colors.success,
    borderRadius: 2,
  },

  // ── White morph bar with rotating gradient border ─────────────────
  morphPillWrap: {
    borderRadius: radii.pill,
    ...shadows.card,
  },
  morphPill: {
    padding: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.background,
    maxWidth: '76%',
  },
  morphSpin: {
    position: 'absolute',
    width: 360,
    height: 360,
    left: '50%',
    top: '50%',
    marginLeft: -180,
    marginTop: -180,
  },
  morphInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  morphTarget: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  morphTargetInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.success,
  },
  morphAddress: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },

  // ── Floating brand header ──────────────────────────────────────────
  mapHeader: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    paddingLeft: 6,
    paddingRight: 14,
    paddingVertical: 6,
    ...shadows.card,
  },
  logoBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },

  // ── Sheet ──────────────────────────────────────────────────────────
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 130,
    flexGrow: 1,
    ...shadows.modal,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E2E6EE',
    alignSelf: 'center',
    marginBottom: 14,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E6EBF8',
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 15,
    ...shadows.card,
  },
  searchTextWrap: {
    flex: 1,
  },
  searchUnderline: {
    alignSelf: 'flex-start',
    borderBottomWidth: 3,
    borderBottomColor: colors.accent,
    paddingBottom: 4,
  },
  searchText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },

  // ── Recent locations ───────────────────────────────────────────────
  recentsList: {
    marginTop: 12,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
  },
  recentDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderStyle: 'dashed',
  },
  recentTextWrap: {
    flex: 1,
  },
  recentName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 22,
  },
  recentSub: {
    ...typography.meta,
    fontSize: 14,
    marginTop: 2,
  },
  emptyHint: {
    ...typography.meta,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 4,
  },

  // ── Place cards ────────────────────────────────────────────────────
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 18,
  },
  placeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  placeImg: {
    width: '100%',
    height: 86,
    backgroundColor: '#EEF2F7',
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
  },
  placeImgFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeLabel: {
    paddingVertical: 9,
    paddingHorizontal: 6,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 17,
  },
  searchCardImg: {
    backgroundColor: '#F3EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Sticky location pill (compact, hugs its content) ───────────────
  locationPillWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
  },
  locationPill: {
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '78%',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    ...shadows.cardHover,
  },
  targetOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.success,
  },
  locationText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
