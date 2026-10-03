import { NavigatorScreenParams } from '@react-navigation/native';
import { VehicleOption } from '../store/rideStore';

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

// Rider Tab Types (legacy — kept for RiderTabNavigator until removed)
export type RiderTabParamList = {
  HomeTab: NavigatorScreenParams<RiderHomeStackParamList>;
  ServicesTab: undefined;
  MyRidesTab: undefined;
  ProfileTab: undefined;
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

// Driver Tab Types
export type DriverTabParamList = {
  DashboardTab: NavigatorScreenParams<DriverDashboardStackParamList>;
  TripsTab: undefined;
  EarningsTab: undefined;
  AccountTab: undefined;
};

// Root Stack Types — single unified app (rider booking + driver mode coexist).
export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  CompleteProfile: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  Admin: NavigatorScreenParams<AdminTabParamList>;
  // Legacy names kept as aliases so deep links / old navigate() calls don't crash.
  RiderMain?: NavigatorScreenParams<RiderTabParamList>;
  DriverMain?: NavigatorScreenParams<DriverTabParamList>;
  CancelRideConfirmation: undefined;
  RideCancelled: { reason?: string };
  RideAnnouncementsSettings: undefined;
  BecomeDriver: undefined;
};

export type DriverDashboardStackParamList = {
  DriverDashboard: undefined;
  RideRequestNearby: undefined;
  TurnByTurnNavigation: { phase: 'to_pickup' | 'in_progress' };
  DriverOtpEntry: undefined;
  DriverPayment: undefined;
  RideAvailableAgain: undefined;
};

// Admin tabs (visible only when user.role === 'admin').
export type AdminTabParamList = {
  ApplicationsTab: undefined;
  DriversTab: undefined;
  RidesTab: undefined;
  AdminAccountTab: undefined;
};
