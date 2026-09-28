import { create } from 'zustand';
import { connectSocket, disconnectSocket } from '../lib/socket';

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
  // True for one screen-load right after login — consumed by the home/
  // dashboard screen to show the welcome NotificationBar, then cleared.
  justLoggedIn: boolean;

  setLanguage: (lang: string) => void;
  setRole: (role: 'rider' | 'driver') => void;
  setPhone: (phone: string) => void;
  setDevelopmentOtp: (otp: string | null) => void;
  login: (userData: User, tokens?: { accessToken: string; refreshToken: string }) => void;
  updateUser: (patch: Partial<User>) => void;
  clearJustLoggedIn: () => void;
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
  justLoggedIn: false,

  setLanguage: (lang) => set({ language: lang }),
  setRole: (role) => set({ role }),
  setPhone: (phone) => set({ phone }),
  setDevelopmentOtp: (otp) => set({ developmentOtp: otp }),

  login: (userData, tokens) => {
    set((state) => ({
      isAuthenticated: true,
      accessToken: tokens?.accessToken ?? state.accessToken,
      refreshToken: tokens?.refreshToken ?? state.refreshToken,
      user: userData,
      justLoggedIn: true,
    }));
    // Connect the shared singleton socket as soon as we have a token.
    const token = tokens?.accessToken;
    if (token) {
      connectSocket(token);
    }
  },

  updateUser: (patch) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...patch } : state.user,
    })),

  clearJustLoggedIn: () => set({ justLoggedIn: false }),

  logout: () => {
    disconnectSocket();
    set({
      isAuthenticated: false,
      user: null,
      role: null,
      accessToken: null,
      refreshToken: null,
      developmentOtp: null,
      justLoggedIn: false,
    });
  },
}));