import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Search, Bell, MapPin, Car, Zap, Clock, ShieldCheck, ChevronRight } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Card } from '../../components/primitives/Card';
import { Pill } from '../../components/primitives/Pill';
import { BottomTabBar } from '../../components/primitives/BottomTabBar';
import { MapPlaceholder } from '../../components/primitives/MapPlaceholder';

interface Props {
  onSearchPress: () => void;
  onSelectVehicle: () => void;
}

export const HomeDashboardScreen: React.FC<Props> = ({ onSearchPress, onSelectVehicle }) => {
  const [activeTab, setActiveTab] = useState<string>('home');
  const [selectedCategory, setSelectedCategory] = useState<string>('daily');

  return (
    <View style={styles.container}>
      {/* Map Background Layer */}
      <MapPlaceholder showRoute={false} pickupText="MG Road Metro Station" dropText="" />

      {/* Top Floating App Bar */}
      <View style={styles.topBar}>
        <View style={styles.userRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>A</Text>
          </View>
          <View>
            <Text style={styles.greetingText}>Hello, Alex 👋</Text>
            <View style={styles.locationPill}>
              <MapPin size={12} color={colors.accent} />
              <Text style={styles.locationText} numberOfLines={1}>MG Road, Bengaluru</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.iconBtn}>
          <Bell size={20} color={colors.textPrimary} />
          <View style={styles.notificationDot} />
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet Card Panel */}
      <View style={styles.bottomSheet}>
        {/* Search Bar Trigger */}
        <TouchableOpacity style={styles.searchBar} activeOpacity={0.88} onPress={onSearchPress}>
          <Search size={22} color={colors.primary} />
          <Text style={styles.searchPlaceholder}>Where are you going today?</Text>
          <View style={styles.searchBadge}>
            <Zap size={14} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {/* Categories Grid */}
        <View style={styles.categoriesRow}>
          <TouchableOpacity style={styles.catCard} onPress={onSelectVehicle}>
            <View style={[styles.catIconWrap, { backgroundColor: colors.accentLight }]}>
              <Car size={26} color={colors.accent} />
            </View>
            <Text style={styles.catLabel}>Daily Cabs</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.catCard} onPress={onSelectVehicle}>
            <View style={[styles.catIconWrap, { backgroundColor: colors.successLight }]}>
              <Text style={styles.autoEmoji}>🛺</Text>
            </View>
            <Text style={styles.catLabel}>Vazhi Auto</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.catCard} onPress={onSelectVehicle}>
            <View style={[styles.catIconWrap, { backgroundColor: '#EEF2FF' }]}>
              <Zap size={26} color={colors.primary} />
            </View>
            <Text style={styles.catLabel}>Express SUV</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.catCard} onPress={onSelectVehicle}>
            <View style={[styles.catIconWrap, { backgroundColor: colors.warningLight }]}>
              <Clock size={26} color={colors.warning} />
            </View>
            <Text style={styles.catLabel}>Rentals</Text>
          </TouchableOpacity>
        </View>

        {/* Promo / Recent Trip Banner */}
        <Card style={styles.promoCard} onPress={onSearchPress}>
          <View style={styles.promoContent}>
            <View style={styles.promoBadge}>
              <Text style={styles.promoBadgeText}>20% OFF</Text>
            </View>
            <Text style={styles.promoTitle}>Save on your next 3 city rides</Text>
            <Text style={styles.promoSub}>Use code VAZHI20 at checkout</Text>
          </View>
          <ChevronRight size={20} color={colors.textSecondary} />
        </Card>
      </View>

      {/* Floating Bottom Tab Navigation */}
      <BottomTabBar activeTab={activeTab} onTabPress={setActiveTab} mode="rider" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: radii.card,
    ...shadows.card,
    borderWidth: 1,
    borderColor: '#EEECF2',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
  },
  greetingText: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    ...typography.meta,
    fontSize: 12,
    maxWidth: 160,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notificationDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 84,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    ...shadows.modal,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: 16,
    height: 54,
    marginBottom: 20,
  },
  searchPlaceholder: {
    flex: 1,
    ...typography.bodyBold,
    fontSize: 15,
    color: colors.textSecondary,
    marginLeft: 12,
  },
  searchBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoriesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  catCard: {
    alignItems: 'center',
    width: 72,
  },
  catIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  autoEmoji: {
    fontSize: 26,
  },
  catLabel: {
    ...typography.metaBold,
    fontSize: 12,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  promoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#FFF6ED',
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  promoContent: {
    flex: 1,
  },
  promoBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  promoBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  promoTitle: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  promoSub: {
    ...typography.meta,
    fontSize: 12,
  },
});
