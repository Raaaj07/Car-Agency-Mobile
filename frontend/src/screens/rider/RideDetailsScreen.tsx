import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CreditCard, Tag, ShieldCheck, Check, X } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Header } from '../../components/primitives/Header';
import { useRideStore } from '../../store/rideStore';
import { Promo, promosApi } from '../../api/promos';
import { getApiError } from '../../api/client';
import {
  normalizePromoCode,
  PROMO_CODE_MAX_LENGTH,
  promoCodeProblem,
  promoDecision,
} from '../../utils/promo';

interface Props {
  onBack?: () => void;
  // May be async: the Confirm Booking button locks itself until it settles,
  // so a double/triple tap can never book twice.
  onConfirmRide?: () => void | Promise<void>;
}

export const RideDetailsScreen: React.FC<Props> = ({ onBack, onConfirmRide }) => {
  const selectedVehicle = useRideStore((state) => state.selectedVehicle);
  const pickupAddress = useRideStore((state) => state.pickupAddress);
  const dropoffAddress = useRideStore((state) => state.dropoffAddress);
  const promoCode = useRideStore((state) => state.promoCode);
  const discountAmount = useRideStore((state) => state.discountAmount);
  const breakdown = useRideStore((state) => state.getFareBreakdown)();
  const setPromo = useRideStore((state) => state.setPromo);
  const insets = useSafeAreaInsets();

  // Promo code entry. The server decides: POST /promos/validate says whether the
  // code works for this rider and how much it takes off; the booking checks it
  // again. Codes created in the admin console work here without an app update.
  const [codeText, setCodeText] = useState('');
  const [checking, setChecking] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [offers, setOffers] = useState<Promo[]>([]);

  // The promos this rider can use right now (the server already filters them).
  useEffect(() => {
    let live = true;
    promosApi
      .getActive()
      .then((list) => {
        if (live) setOffers(list);
      })
      .catch(() => {
        // Offers are a convenience; typing a code still works.
      });
    return () => {
      live = false;
    };
  }, []);

  const applyCode = async (raw: string) => {
    if (checking) return;
    const code = normalizePromoCode(raw);
    const problem = promoCodeProblem(code);
    if (problem) {
      setPromoMessage(problem);
      return;
    }
    setChecking(true);
    setPromoMessage(null);
    try {
      const decision = promoDecision(await promosApi.validate(code), code);
      if (decision.ok) {
        setPromo(decision.code, decision.discountAmount);
        setCodeText('');
      } else {
        setPromoMessage(decision.message);
      }
    } catch (error) {
      setPromoMessage(getApiError(error));
    } finally {
      setChecking(false);
    }
  };

  const removeCode = () => {
    setPromo(null, 0);
    setPromoMessage(null);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {onBack && <Header title="Ride Summary" onBack={onBack} />}

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Selected Vehicle Overview */}
        <Card style={styles.vehicleSummaryCard}>
          <View style={styles.vehicleRow}>
            <Text style={styles.vehicleEmoji}>{selectedVehicle.icon}</Text>
            <View style={styles.vehicleInfo}>
              <Text style={styles.vehicleTitle}>{selectedVehicle.name}</Text>
              <Text style={styles.vehicleSub}>{selectedVehicle.type}</Text>
            </View>
            <Text style={styles.totalPrice}>₹{breakdown.total}</Text>
          </View>
        </Card>

        {/* Pickup & Drop Route Summary */}
        <Card style={styles.routeCard}>
          <Text style={styles.sectionTitle}>TRIP ROUTE</Text>
          <View style={styles.routeRow}>
            <View style={styles.dotsColumn}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <View style={styles.line} />
              <View style={[styles.dot, { backgroundColor: colors.danger }]} />
            </View>

            <View style={styles.addressCol}>
              <View style={styles.addrItem}>
                <Text style={styles.addrLabel}>PICKUP LOCATION</Text>
                <Text style={styles.addrText}>{pickupAddress}</Text>
              </View>
              <View style={styles.addrItem}>
                <Text style={styles.addrLabel}>DROP-OFF LOCATION</Text>
                <Text style={styles.addrText}>{dropoffAddress}</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Payment Method Selector */}
        <Card style={styles.cardSection}>
          <Text style={styles.sectionTitle}>PAYMENT METHOD</Text>
          <View style={styles.paymentRow}>
            <View style={styles.paymentIcon}>
              <CreditCard size={20} color={colors.primary} />
            </View>
            <View style={styles.paymentInfo}>
              <Text style={styles.paymentName}>UPI QR / Cash</Text>
              <Text style={styles.paymentSub}>Pay the driver directly after the ride</Text>
            </View>
          </View>
        </Card>

        {/* Promo Code: apply a code (or one of the offers) and remove it again */}
        <Card style={styles.cardSection}>
          <Text style={styles.sectionTitle}>PROMO CODE</Text>
          {promoCode ? (
            <View style={styles.promoInputRow}>
              <Tag size={20} color={colors.accent} style={{ marginRight: 8 }} />
              <Text style={styles.promoCodeText}>{promoCode}</Text>
              <View style={styles.appliedBadge}>
                <Check size={14} color={colors.success} />
                <Text style={styles.appliedText}>₹{discountAmount} Saved</Text>
              </View>
              <TouchableOpacity
                onPress={removeCode}
                accessibilityRole="button"
                accessibilityLabel="Remove promo code"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.removeBtn}
              >
                <X size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.codeEntryRow}>
                <TextInput
                  style={styles.codeInput}
                  value={codeText}
                  onChangeText={(text) => {
                    setCodeText(text.toUpperCase());
                    setPromoMessage(null);
                  }}
                  placeholder="Enter promo code"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={PROMO_CODE_MAX_LENGTH}
                  returnKeyType="done"
                  editable={!checking}
                  onSubmitEditing={() => void applyCode(codeText)}
                />
                <Button
                  title="Apply"
                  size="small"
                  variant="accent"
                  fullWidth={false}
                  loading={checking}
                  disabled={checking || !codeText.trim()}
                  onPress={() => void applyCode(codeText)}
                />
              </View>
              {promoMessage ? <Text style={styles.promoError}>{promoMessage}</Text> : null}
              {offers.length > 0 ? (
                <View style={styles.offerList}>
                  {offers.map((offer) => (
                    <TouchableOpacity
                      key={offer.code}
                      style={styles.offerChip}
                      disabled={checking}
                      onPress={() => void applyCode(offer.code)}
                      accessibilityRole="button"
                      accessibilityLabel={`Apply promo code ${offer.code}`}
                    >
                      <Text style={styles.offerCode}>{offer.code}</Text>
                      <Text style={styles.offerTitle} numberOfLines={1}>
                        {offer.title}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </Card>

        {/* Safety Banner */}
        <View style={styles.safetyBox}>
          <ShieldCheck size={20} color={colors.success} />
          <Text style={styles.safetyText}>
            During your ride you can share your live trip and send an SOS to the Vazhi team from the trip screen.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Confirm Action */}
      {onConfirmRide && (
        <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>
          <View style={styles.fareRow}>
            <View style={styles.fareTextWrap}>
              <Text style={styles.fareLabel}>Estimated Fare</Text>
              <Text style={styles.fareSub}>Final fare follows the distance driven.</Text>
            </View>
            <Text style={styles.fareAmount}>₹{breakdown.total}</Text>
          </View>

          <Button title="Confirm Booking" onPress={onConfirmRide} variant="primary" size="large" />
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 130,
    gap: 16,
  },
  vehicleSummaryCard: {
    padding: 16,
    backgroundColor: colors.primary,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleTitle: {
    ...typography.cardTitle,
    color: '#FFFFFF',
  },
  vehicleSub: {
    ...typography.meta,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  totalPrice: {
    ...typography.heading,
    color: colors.accent,
  },
  routeCard: {
    padding: 16,
  },
  sectionTitle: {
    ...typography.metaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 12,
  },
  routeRow: {
    flexDirection: 'row',
  },
  dotsColumn: {
    alignItems: 'center',
    marginRight: 12,
    paddingVertical: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  line: {
    width: 2,
    height: 38,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  addressCol: {
    flex: 1,
    gap: 12,
  },
  addrItem: {},
  addrLabel: {
    ...typography.metaBold,
    fontSize: 9,
    color: colors.textMuted,
  },
  addrText: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  cardSection: {
    padding: 16,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  paymentInfo: {
    flex: 1,
  },
  paymentName: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  paymentSub: {
    ...typography.meta,
    fontSize: 12,
  },
  promoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF6ED',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.3)',
  },
  promoCodeText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.accent,
    flex: 1,
  },
  appliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    gap: 4,
  },
  appliedText: {
    ...typography.metaBold,
    fontSize: 11,
    color: colors.success,
  },
  removeBtn: {
    marginLeft: 10,
    padding: 2,
  },
  codeEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  promoError: {
    ...typography.meta,
    fontSize: 12,
    color: colors.danger,
    marginTop: 8,
  },
  offerList: {
    marginTop: 12,
    gap: 8,
  },
  offerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF6ED',
    borderWidth: 1,
    borderColor: 'rgba(224, 138, 52, 0.3)',
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  offerCode: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.accent,
  },
  offerTitle: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
  },
  safetyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    padding: 14,
    borderRadius: radii.card,
    gap: 10,
  },
  safetyText: {
    ...typography.meta,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    gap: 14,
    ...shadows.card,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The note under the label is long: let it wrap instead of squeezing the amount.
  fareTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  fareLabel: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  fareSub: {
    ...typography.meta,
    fontSize: 11,
  },
  fareAmount: {
    ...typography.heading,
    fontSize: 24,
    color: colors.primary,
  },
});
