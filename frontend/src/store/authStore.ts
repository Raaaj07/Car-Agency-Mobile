import { create } from 'zustand';

export interface User {
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
}

interface AuthState {
  language: string;
  role: 'rider' | 'driver' | null;
  phone: string;
  user: User | null;
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  developmentOtp: string | null;

  setLanguage: (lang: string) => void;
  setRole: (role: 'rider' | 'driver') => void;
  setPhone: (phone: string) => void;
  setDevelopmentOtp: (otp: string | null) => void;
  login: (userData: User, tokens?: { accessToken: string; refreshToken: string }) => void;
  updateUser: (patch: Partial<User>) => void; // ADD — used by the profile edit screen
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  language: 'en',
  role: null,
  phone: '+91 98765 43210',
  user: null,
  isAuthenticated: false,
  accessToken: null,
  refreshToken: null,
  developmentOtp: null,

  setLanguage: (lang) => set({ language: lang }),
  setRole: (role) => set({ role }),
  setPhone: (phone) => set({ phone }),
  setDevelopmentOtp: (otp) => set({ developmentOtp: otp }),

  // Now takes the REAL user object straight from the backend response —
  // no more inventing a fallback name. Whatever the API returns is what's shown.
  login: (userData, tokens) =>
    set((state) => ({
      isAuthenticated: true,
      accessToken: tokens?.accessToken ?? state.accessToken,
      refreshToken: tokens?.refreshToken ?? state.refreshToken,
      user: userData,
    })),

  updateUser: (patch) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...patch } : state.user,
    })),

  logout: () =>
    set({
      isAuthenticated: false,
      user: null,
      role: null,
      accessToken: null,
      refreshToken: null,
      developmentOtp: null,
    }),
}));