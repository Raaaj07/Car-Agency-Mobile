import { create } from 'zustand';

export interface User {
  name: string;
  phone: string;
  avatar?: string;
}

interface AuthState {
  language: string;
  role: 'rider' | 'driver' | null;
  phone: string;
  user: User | null;
  isAuthenticated: boolean;

  setLanguage: (lang: string) => void;
  setRole: (role: 'rider' | 'driver') => void;
  setPhone: (phone: string) => void;
  login: (userData?: Partial<User>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  language: 'en',
  role: null,
  phone: '+91 98765 43210',
  user: null,
  isAuthenticated: false,

  setLanguage: (lang) => set({ language: lang }),
  setRole: (role) => set({ role }),
  setPhone: (phone) => set({ phone }),
  login: (userData) =>
    set((state) => ({
      isAuthenticated: true,
      user: {
        name: userData?.name || (state.role === 'driver' ? 'Rajesh Kumar' : 'Alex Morgan'),
        phone: userData?.phone || state.phone,
      },
    })),
  logout: () =>
    set({
      isAuthenticated: false,
      user: null,
      role: null,
    }),
}));
