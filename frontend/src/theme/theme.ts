export const colors = {
  primary: '#211B4E',      // Navy primary
  primaryLight: '#2C2468', // Slightly lighter navy for hover/active
  primaryDark: '#171238',  // Darker navy for borders/shadows
  accent: '#E08A34',       // Amber accent
  accentLight: '#FFF6ED',  // Amber tint background
  success: '#22C55E',      // Green status
  successLight: '#DCFCE7', // Soft green background
  danger: '#EF4444',       // Red status / error / cancel
  dangerLight: '#FEE2E2',  // Soft red background
  warning: '#F59E0B',      // Warning yellow
  warningLight: '#FEF3C7', // Soft warning background

  // Grays & Neutrals
  background: '#F6F5F8',   // Light gray app background
  card: '#FFFFFF',         // White card surface
  surface: '#F8FAFC',      // Soft surface tint
  border: '#E5E7EB',       // Subtle line border
  borderLight: '#F1F5F9',  // Very soft divider

  // Text colors
  textPrimary: '#1E1B2E',   // Dark navy text
  textSecondary: '#6B7280', // Slate gray body text
  textMuted: '#9CA3AF',     // Light gray caption/meta text
  textLight: '#FFFFFF',     // White text on dark cards/buttons
  textAmber: '#D97706',     // Amber text
  textNavy: '#211B4E',      // Navy text highlight
};

export const typography = {
  heading: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    lineHeight: 34,
  },
  subheading: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    lineHeight: 26,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  bodyBold: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  meta: {
    fontSize: 13,
    fontWeight: '400' as const,
    color: colors.textMuted,
    lineHeight: 18,
  },
  metaBold: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: colors.textLight,
  },
};

export const radii = {
  card: 22,
  button: 16,
  input: 16,
  pill: 999,
  avatar: 999,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHover: {
    shadowColor: '#211B4E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 5,
  },
  button: {
    shadowColor: '#211B4E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
};
