export interface PromoConfig {
  code: string;
  title: string;
  subtitle: string;
  cta: string;
  discountAmount: number;
  firstRideOnly: boolean;
}

export const PROMOS_CONFIG: PromoConfig[] = [
  {
    code: 'VAZHI20',
    title: 'Rs 40 off your first ride',
    subtitle: 'Tap to apply code VAZHI20',
    cta: 'Apply',
    discountAmount: 40,
    firstRideOnly: true,
  },
];
