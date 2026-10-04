import { create } from 'zustand';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RideLocation {
  address: string;
  lat: number;
  lng: number;
}

export interface VehicleOption {
  id: string;
  name: string;
  type: string;
  price: string;
  numericPrice: number;
  eta: string;
  seats: number;
  badge?: string;
  icon: string;
}

export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  timeCharge: number;
  tollFee: number;
  taxes: number;
  discount: number;
  total: number;
}

export interface DriverInfo {
  name: string;
  rating: number;
  carModel: string;
  plateNumber: string;
  otp: string;
  eta: string;
  phone: string;
}

/** Safe driver subset returned by GET /rides* (rider view). No phone/docs. */
export interface RideDriverInfo {
  name: string;
  rating?: number | null;
  vehicleModel?: string | null;
  plateNumber?: string | null;
  vehicleType?: string | null;
  /** Profile photo: https Cloudinary URL or API-relative /users/<id>/avatar. */
  avatar?: string | null;
}

export interface ActiveRide {
  id: string;
  status: string;
  riderName?: string;
  /** Rider's profile photo (driver-side offer/trip cards). */
  riderAvatar?: string | null;
  pickupOtp?: string | null;
  fareBreakdown: FareBreakdown;
  /** P-1: pending → rider_claimed → paid | disputed (+ failed). */
  paymentStatus: 'pending' | 'rider_claimed' | 'paid' | 'disputed' | 'failed';
  pickup?: RideLocation;
  dropoff?: RideLocation;
  vehicleType?: string;
  distanceKm?: string | null;
  expiresInSeconds?: number;
  // Needed so FindingDriverScreen can hand the real cancellation reason to
  // RideCancelledScreen when the poll (not the modal) detects the cancel.
  cancellationReason?: string | null;
  // Safe driver info (name/vehicle) when a driver is assigned.
  driver?: RideDriverInfo | null;
  // Tip submitted with the rider's review (part of the collectable amount).
  tipAmount?: number;
  // Set once the ride completes (used for duration on RideCompleted).
  completedAt?: string | null;
  // Origin marker: rides written by restoreActiveRide() are rider-flow state
  // and must never be treated as a driver-mode job offer.
  source?: 'rider-restore';
  createdAt?: string;
}

interface RideState {
  pickup: string;
  dropoff: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickupCoords?: LatLng;
  dropoffCoords?: LatLng;
  selectedVehicle: VehicleOption;
  driver: DriverInfo;
  promoCode: string | null;
  discountAmount: number;
  cancellationReason: string;
  rating: number;
  compliments: string[];
  tipAmount: number;
  activeRide: ActiveRide | null;
  /** Vehicle type to pre-select on VehicleSelection; cleared after first use. */
  preferredVehicleId: string | null;
  /**
   * R-1: what the last book/rematch call came back with. Kept outside
   * activeRide because status polls replace that object and would drop it.
   * null = no search yet / no longer relevant.
   */
  matchResult: 'offered' | 'no_drivers' | null;

  setPickup: (location: string, address?: string, coords?: LatLng) => void;
  setDropoff: (location: string, address?: string, coords?: LatLng) => void;
  setSelectedVehicle: (vehicle: VehicleOption) => void;
  applyPromoCode: (code: string) => void;
  setCancellationReason: (reason: string) => void;
  setRating: (rating: number) => void;
  toggleCompliment: (compliment: string) => void;
  setTipAmount: (amount: number) => void;
  setActiveRide: (ride: ActiveRide | null) => void;
  setMatchResult: (result: 'offered' | 'no_drivers' | null) => void;
  getFareBreakdown: () => FareBreakdown;
  resetRide: () => void;
  setPreferredVehicle: (id: string | null) => void;
}

const defaultVehicle: VehicleOption = {
  id: 'sedan',
  name: 'Comfort Sedan',
  type: 'Spacious AC sedans',
  price: '₹240',
  numericPrice: 240,
  eta: '2 min',
  seats: 4,
  badge: 'Fastest',
  icon: '🚘',
};

// No demo driver — real driver comes from activeRide / socket only.
const defaultDriver: DriverInfo = {
  name: '',
  rating: 0,
  carModel: '',
  plateNumber: '',
  otp: '',
  eta: '',
  phone: '',
};

export const useRideStore = create<RideState>((set, get) => ({
  pickup: '',
  pickupAddress: '',
  dropoff: '',
  dropoffAddress: '',
  pickupCoords: undefined,
  dropoffCoords: undefined,
  selectedVehicle: defaultVehicle,
  driver: defaultDriver,
  promoCode: null,
  discountAmount: 0,
  cancellationReason: '',
  rating: 5,
  compliments: [],
  tipAmount: 0,
  activeRide: null,
  preferredVehicleId: null,
  matchResult: null,

  setPickup: (location, address, coords) =>
    set((state) => ({
      pickup: location,
      pickupAddress: address || location,
      pickupCoords: coords ?? state.pickupCoords,
    })),

  setDropoff: (location, address, coords) =>
    set((state) => ({
      dropoff: location,
      dropoffAddress: address || location,
      dropoffCoords: coords ?? state.dropoffCoords,
    })),

  setSelectedVehicle: (vehicle) =>
    set({
      selectedVehicle: vehicle,
    }),

  applyPromoCode: (code) => {
    const normalized = code.trim().toUpperCase();
    // Only known codes apply; unknown codes are rejected (no silent discount).
    if (normalized === 'VAZHI20') {
      set({ promoCode: 'VAZHI20', discountAmount: 40 });
    } else if (!normalized) {
      set({ promoCode: null, discountAmount: 0 });
    } else {
      set({ promoCode: null, discountAmount: 0 });
    }
  },

  setCancellationReason: (reason) => set({ cancellationReason: reason }),

  setRating: (rating) => set({ rating }),

  toggleCompliment: (compliment) =>
    set((state) => ({
      compliments: state.compliments.includes(compliment)
        ? state.compliments.filter((c) => c !== compliment)
        : [...state.compliments, compliment],
    })),

  setTipAmount: (amount) => set({ tipAmount: amount }),
  setActiveRide: (ride) =>
    // Replace (don't merge) so stale pickupOtp/status fields can't survive transitions.
    set(() => ({ activeRide: ride })),

  setMatchResult: (result) => set(() => ({ matchResult: result })),

  getFareBreakdown: () => {
    const { selectedVehicle, discountAmount, activeRide } = get();
    if (activeRide) return activeRide.fareBreakdown;
    const base = Math.round(selectedVehicle.numericPrice * 0.5);
    const dist = Math.round(selectedVehicle.numericPrice * 0.3);
    const time = Math.round(selectedVehicle.numericPrice * 0.1);
    const toll = 40;
    const taxes = 28;
    // Total must equal the sum of parts minus discount (matches backend).
    const total = Math.max(base + dist + time + toll + taxes - discountAmount, 0);

    return {
      baseFare: base,
      distanceFare: dist,
      timeCharge: time,
      tollFee: toll,
      taxes,
      discount: discountAmount,
      total,
    };
  },

  // Preserve pickup/pickupAddress/pickupCoords so the home map keeps the
  // rider's location after a completed or cancelled ride. Only clear dropoff,
  // activeRide and ride-specific fields.
  resetRide: () =>
    set((state) => ({
      dropoff: '',
      dropoffAddress: '',
      dropoffCoords: undefined,
      promoCode: null,
      discountAmount: 0,
      cancellationReason: '',
      rating: 5,
      compliments: [],
      tipAmount: 0,
      activeRide: null,
      matchResult: null,
      // Preserve pickup so the home screen stays centred on the last known position.
      pickup: state.pickup,
      pickupAddress: state.pickupAddress,
      pickupCoords: state.pickupCoords,
    })),

  setPreferredVehicle: (id) => set({ preferredVehicleId: id }),
}));