import { create } from 'zustand';

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

interface RideState {
  pickup: string;
  dropoff: string;
  pickupAddress: string;
  dropoffAddress: string;
  selectedVehicle: VehicleOption;
  driver: DriverInfo;
  promoCode: string | null;
  discountAmount: number;
  cancellationReason: string;
  rating: number;
  compliments: string[];
  tipAmount: number;

  setPickup: (location: string, address?: string) => void;
  setDropoff: (location: string, address?: string) => void;
  setSelectedVehicle: (vehicle: VehicleOption) => void;
  applyPromoCode: (code: string) => void;
  setCancellationReason: (reason: string) => void;
  setRating: (rating: number) => void;
  toggleCompliment: (compliment: string) => void;
  setTipAmount: (amount: number) => void;
  getFareBreakdown: () => FareBreakdown;
  resetRide: () => void;
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

const defaultDriver: DriverInfo = {
  name: 'Rajesh Kumar',
  rating: 4.9,
  carModel: 'White Maruti Dzire',
  plateNumber: 'KA 05 MN 4821',
  otp: '4892',
  eta: '3 min',
  phone: '+91 98765 12345',
};

export const useRideStore = create<RideState>((set, get) => ({
  pickup: 'MG Road Metro Station',
  pickupAddress: 'MG Road Metro Station, Entrance Gate 2',
  dropoff: 'Indiranagar 100 Feet Rd',
  dropoffAddress: 'Indiranagar 100 Feet Road, Hub 4',
  selectedVehicle: defaultVehicle,
  driver: defaultDriver,
  promoCode: 'VAZHI20',
  discountAmount: 40,
  cancellationReason: 'Driver is taking too long to arrive',
  rating: 5,
  compliments: ['Safe Driver 🛡️'],
  tipAmount: 20,

  setPickup: (location, address) =>
    set({
      pickup: location,
      pickupAddress: address || location,
    }),

  setDropoff: (location, address) =>
    set({
      dropoff: location,
      dropoffAddress: address || location,
    }),

  setSelectedVehicle: (vehicle) =>
    set({
      selectedVehicle: vehicle,
    }),

  applyPromoCode: (code) => {
    if (code.toUpperCase() === 'VAZHI20') {
      set({ promoCode: 'VAZHI20', discountAmount: 40 });
    } else {
      set({ promoCode: code, discountAmount: 20 });
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

  getFareBreakdown: () => {
    const { selectedVehicle, discountAmount } = get();
    const base = Math.round(selectedVehicle.numericPrice * 0.5);
    const dist = Math.round(selectedVehicle.numericPrice * 0.3);
    const time = Math.round(selectedVehicle.numericPrice * 0.1);
    const toll = 40;
    const taxes = 28;
    const total = selectedVehicle.numericPrice;

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

  resetRide: () =>
    set({
      pickup: 'MG Road Metro Station',
      dropoff: 'Indiranagar 100 Feet Rd',
      selectedVehicle: defaultVehicle,
      promoCode: 'VAZHI20',
      discountAmount: 40,
      cancellationReason: 'Driver is taking too long to arrive',
      rating: 5,
      compliments: ['Safe Driver 🛡️'],
      tipAmount: 20,
    }),
}));
