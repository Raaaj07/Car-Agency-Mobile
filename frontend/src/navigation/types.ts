import { NavigatorScreenParams } from '@react-navigation/native';

// Onboarding Stack Types — sign-in only. Profile completion is a root-level
// gate (AppNavigator) driven by server user.profileComplete.
export type OnboardingStackParamList = {
  LanguageSelection: undefined;
  SignIn: undefined;
  MobileNumber: undefined;
  OTPVerification: undefined;
};

// Rider Home Stack Types
export type RiderHomeStackParamList = {
  HomeDashboard: undefined;
  DestinationSearch: { focus?: 'pickup' | 'dropoff' } | undefined;
  VehicleSelection: undefined;
  RideDetails: undefined;
  FindingDriver: undefined;
  YouGotTheRide: undefined;
  DriverEnRoute: undefined;
  TripProgress: undefined;
  ReviewRide: undefined;
  PaymentFareBreakdown: undefined;
  RideCompleted: undefined;
};

// Rider-mode tabs: booking only. No driver UI is registered in this tree.
export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<RiderHomeStackParamList>;
  ServicesTab: undefined;
  TripsTab: undefined;
  ProfileTab: undefined;
};

// Driver-mode tabs (only mounted when approved + activeMode === 'driver').
export type DriverMainTabParamList = {
  DashboardTab: NavigatorScreenParams<DriverDashboardStackParamList>;
  TripsTab: undefined;
  EarningsTab: undefined;
  ProfileTab: undefined;
};

// Root Stack Types — single unified app (rider booking + driver mode coexist).
export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  CompleteProfile: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  Admin: NavigatorScreenParams<AdminTabParamList>;
  CancelRideConfirmation: undefined;
  RideCancelled: { reason?: string };
  RideAnnouncementsSettings: undefined;
  BecomeDriver: undefined;
  // Profile-page destinations (both modes) — modal group in AppNavigator.
  HelpSupport: undefined;
  MyVehicle: undefined;
  PaymentQr: undefined;
};

export type DriverDashboardStackParamList = {
  DriverDashboard: undefined;
  RideRequestNearby: undefined;
  TurnByTurnNavigation: { phase: 'to_pickup' | 'in_progress' };
  DriverOtpEntry: undefined;
  DriverPayment: undefined;
};

// Admin tabs (visible only when user.role === 'admin') — Phase 4 console:
// Overview + Drivers (applications) + Rides + Account, each with its own
// stack so detail screens push over the list and hide the floating tab bar
// (Account's stack holds the profile + the Promo codes manager).
export type AdminTabParamList = {
  overview: NavigatorScreenParams<AdminOverviewStackParamList>;
  drivers: NavigatorScreenParams<AdminDriversStackParamList>;
  rides: NavigatorScreenParams<AdminRidesStackParamList>;
  account: NavigatorScreenParams<AdminAccountStackParamList>;
};

// ── Admin console stacks ──
export type AdminAccountStackParamList = {
  AdminAccount: undefined;
  AdminPromos: undefined;
};

export type AdminOverviewStackParamList = {
  AdminOverview: undefined;
};

/** Initial segment for the Drivers list (Overview stat-card tap-through). */
export type AdminDriversSegment = 'pending' | 'approved' | 'suspended' | 'rejected';

export type AdminDriversStackParamList = {
  AdminDrivers: { segment?: AdminDriversSegment } | undefined;
  AdminDriverDetail: { driverId: string };
};

/** Initial filters for the Rides list (Overview stat-card tap-through). */
export type AdminRidesPreset = {
  status?: 'active';
  payment?: 'unpaid';
  date?: 'today';
};

export type AdminRidesStackParamList = {
  AdminRides: AdminRidesPreset | undefined;
  AdminRideDetail: { rideId: string };
};
