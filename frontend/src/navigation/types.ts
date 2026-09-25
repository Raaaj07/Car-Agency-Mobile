import { NavigatorScreenParams } from '@react-navigation/native';
import { VehicleOption } from '../store/rideStore';

// Onboarding Stack Types
export type OnboardingStackParamList = {
  LanguageSelection: undefined;
  RoleSelection: undefined;
  SignIn: undefined;
  MobileNumber: undefined;
  OTPVerification: undefined;
};

// Rider Home Stack Types
export type RiderHomeStackParamList = {
  HomeDashboard: undefined;
  DestinationSearch: undefined;
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

// Rider Tab Types
export type RiderTabParamList = {
  HomeTab: NavigatorScreenParams<RiderHomeStackParamList>;
  ServicesTab: undefined;
  MyRidesTab: undefined;
  ProfileTab: undefined;
};

// Driver Stack Types
export type DriverDashboardStackParamList = {
  DriverDashboard: undefined;
  RideRequestNearby: undefined;
  TurnByTurnNavigation: undefined;
  RideAvailableAgain: undefined;
};

// Driver Tab Types
export type DriverTabParamList = {
  DashboardTab: NavigatorScreenParams<DriverDashboardStackParamList>;
  TripsTab: undefined;
  EarningsTab: undefined;
  AccountTab: undefined;
};

// Root Stack Types
export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  RiderMain: NavigatorScreenParams<RiderTabParamList>;
  DriverMain: NavigatorScreenParams<DriverTabParamList>;
  CancelRideConfirmation: undefined;
  RideCancelled: { reason?: string };
  RideAnnouncementsSettings: undefined;
};
