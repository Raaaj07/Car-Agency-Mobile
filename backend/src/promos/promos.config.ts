export interface PromoConfig {
  code: string;
  title: string;
  subtitle: string;
  cta: string;
  discountAmount: number;
  firstRideOnly: boolean;
}

// PR-1: copy fix — the public code is VAZHI20, so the title and the discount
// amount must both say Rs 20 (they previously claimed Rs 40). The real
// promo-redemption table (validity windows, max redemptions, admin CRUD) is
// Phase 7 stretch; until then this config + the client-side fallback in
// rideStore.applyPromoCode are the two sources of truth and must stay in sync.
export const PROMOS_CONFIG: PromoConfig[] = [
  {
    code: 'VAZHI20',
    title: 'Rs 20 off your first ride',
    subtitle: 'Tap to apply code VAZHI20',
    cta: 'Apply',
    discountAmount: 20,
    firstRideOnly: true,
  },
];
