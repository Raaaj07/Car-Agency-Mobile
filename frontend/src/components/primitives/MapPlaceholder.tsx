import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { MapPin, Navigation, Car, Shield } from 'lucide-react-native';
import { colors, radii, typography } from '../../theme/theme';

interface MapPlaceholderProps {
  style?: ViewStyle;
  children?: React.ReactNode;
  pickupText?: string;
  dropText?: string;
  showRoute?: boolean;
  showRadar?: boolean;
  showDriverPin?: boolean;
  driverEta?: string;
  darkTheme?: boolean;
}

export const MapPlaceholder: React.FC<MapPlaceholderProps> = ({
  style,
  children,
  pickupText = 'Current Location - MG Road',
  dropText = 'Indiranagar Metro Station',
  showRoute = true,
  showRadar = false,
  showDriverPin = false,
  driverEta,
  darkTheme = false,
}) => {
  return (
    <View style={[styles.container, darkTheme ? styles.darkMap : styles.lightMap, style]}>
      {/* Mock Map Grid & Road Lines */}
      <View style={styles.gridContainer}>
        <View style={[styles.roadLineHorizontal, { top: '35%' }, darkTheme && styles.roadDark]} />
        <View style={[styles.roadLineHorizontal, { top: '65%' }, darkTheme && styles.roadDark]} />
        <View style={[styles.roadLineVertical, { left: '40%' }, darkTheme && styles.roadDark]} />
        <View style={[styles.roadLineVertical, { left: '75%' }, darkTheme && styles.roadDark]} />
        <View style={[styles.blockArea, { top: '15%', left: '10%', width: 100, height: 80 }]} />
        <View style={[styles.blockArea, { top: '42%', left: '50%', width: 140, height: 90 }]} />
        <View style={[styles.blockArea, { top: '70%', left: '15%', width: 120, height: 70 }]} />
      </View>

      {/* Radar scanning circle if active */}
      {showRadar && (
        <View style={styles.radarCenter}>
          <View style={styles.radarPulseOuter} />
          <View style={styles.radarPulseInner} />
          <View style={styles.radarDot}>
            <Navigation size={20} color="#FFFFFF" />
          </View>
        </View>
      )}

      {/* Mock Route Line */}
      {showRoute && (
        <View style={styles.routeOverlay}>
          <View style={styles.pickupPin}>
            <View style={styles.dotGreen} />
          </View>
          <View style={styles.routeDashLine} />
          <View style={styles.dropPin}>
            <MapPin size={22} color={colors.danger} fill={colors.danger} />
          </View>
        </View>
      )}

      {/* Driver Pin */}
      {showDriverPin && (
        <View style={styles.driverPinWrap}>
          {driverEta && (
            <View style={styles.etaBubble}>
              <Text style={styles.etaText}>{driverEta}</Text>
            </View>
          )}
          <View style={styles.driverIconCircle}>
            <Car size={18} color="#FFFFFF" />
          </View>
        </View>
      )}

      {/* Top Location Summary Floating Box */}
      {(pickupText || dropText) && !showRadar && (
        <View style={styles.topCard}>
          <View style={styles.locationRow}>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
            <Text style={styles.locationText} numberOfLines={1}>
              {pickupText}
            </Text>
          </View>
          {dropText && (
            <>
              <View style={styles.locationDivider} />
              <View style={styles.locationRow}>
                <View style={[styles.dot, { backgroundColor: colors.danger }]} />
                <Text style={styles.locationText} numberOfLines={1}>
                  {dropText}
                </Text>
              </View>
            </>
          )}
        </View>
      )}

      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  lightMap: {
    backgroundColor: '#E8ECF2',
  },
  darkMap: {
    backgroundColor: '#1E293B',
  },
  gridContainer: {
    ...StyleSheet.absoluteFill,
    opacity: 0.6,
  },
  roadLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: '#FFFFFF',
  },
  roadLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 18,
    backgroundColor: '#FFFFFF',
  },
  roadDark: {
    backgroundColor: '#334155',
  },
  blockArea: {
    position: 'absolute',
    backgroundColor: '#D1D5DB',
    borderRadius: 8,
    opacity: 0.3,
  },
  radarCenter: {
    position: 'absolute',
    top: '38%',
    left: '50%',
    marginLeft: -60,
    marginTop: -60,
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarPulseOuter: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(33, 27, 78, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(33, 27, 78, 0.25)',
  },
  radarPulseInner: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(33, 27, 78, 0.2)',
  },
  radarDot: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeOverlay: {
    position: 'absolute',
    top: '25%',
    left: '30%',
    alignItems: 'center',
  },
  pickupPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotGreen: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
  },
  routeDashLine: {
    width: 3,
    height: 90,
    backgroundColor: colors.primary,
    marginVertical: 4,
    borderRadius: 2,
  },
  dropPin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverPinWrap: {
    position: 'absolute',
    top: '40%',
    left: '55%',
    alignItems: 'center',
  },
  etaBubble: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    marginBottom: 4,
  },
  etaText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  driverIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  topCard: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.card,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#EEECF2',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 8,
    marginLeft: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  locationText: {
    ...typography.bodyBold,
    fontSize: 14,
    flex: 1,
  },
});
