import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { connectSocket, disconnectSocket, refreshSocketAuth } from '../lib/socket';
import {
  ACCESS_TOKEN_KEY as ACCESS_KEY,
  REFRESH_TOKEN_KEY as REFRESH_KEY,
  tokenManager,
} from '../lib/tokenManager';
import { stopDriverBackgroundLocation } from '../lib/locationTask';

export type DriverStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';

export interface User {
  id?: string;
  name: string;
  phone: string;
  role?: 'rider' | 'driver' | 'admin';
  profileComplete?: boolean;
  driverStatus?: DriverStatus;
  email?: string;
  avatar?: string;
}

const MODE_KEY = 'vazhi.activeMode';

async function saveSecure(key: string, value: string | null) {
  try {
    if (value == null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // SecureStore unavailable (e.g. Expo Go without native module) — session
    // simply won't survive restart.
  }
}

interface AuthState {
  language: string;
  phone: string;
  user: User | null;
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  developmentOtp: string | null;
  activeMode: 'rider' | 'driver';
  hydrated: boolean;
  bootOffline: boolean;
  justLoggedIn: boolean;

  setLanguage: (lang: string) => void;
  setPhone: (phone: string) => void;
  setDevelopmentOtp: (otp: string | null) => void;
  setActiveMode: (mode: 'rider' | 'driver') => void;
  setHydrated: () => void;
  login: (userData: User, tokens?: { accessToken: string; refreshToken: string }) => void;
  updateUser: (patch: Partial<User>) => void;
  clearJustLoggedIn: () => void;
  logout: (remote?: boolean) => void;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  language: 'en',
  phone: '',
  user: null,
  isAuthenticated: false,
  accessToken: null,
  refreshToken: null,
  developmentOtp: null,
  activeMode: 'rider',
  hydrated: false,
  bootOffline: false,
  justLoggedIn: false,

  setLanguage: (lang) => set({ language: lang }),
  setPhone: (phone) => set({ phone }),
  setDevelopmentOtp: (otp) => set({ developmentOtp: otp }),
  setActiveMode: (mode) => {
    set({ activeMode: mode });
    void saveSecure(MODE_KEY, mode);
  },
  setHydrated: () => set({ hydrated: true }),

  login: (userData, tokens) => {
    const role = userData.role ?? 'rider';
    // Non-approved users can never sit in driver mode.
    const mode: 'rider' | 'driver' =
      userData.driverStatus === 'approved' ? useAuthStore.getState().activeMode : 'rider';
    set((state) => ({
      isAuthenticated: true,
      accessToken: tokens?.accessToken ?? state.accessToken,
      refreshToken: tokens?.refreshToken ?? state.refreshToken,
      user: userData,
      activeMode: mode,
      justLoggedIn: true,
    }));
    if (tokens?.accessToken || tokens?.refreshToken) {
      tokenManager.setTokens({
        ...(tokens.accessToken ? { accessToken: tokens.accessToken } : {}),
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      });
      void saveSecure(ACCESS_KEY, tokens.accessToken ?? null);
      void saveSecure(REFRESH_KEY, tokens.refreshToken ?? null);
    }
    const token = tokens?.accessToken;
    if (token) {
      // A-14: admins keep their own role — the gateway joins them to the
      // `admins` room (new-application pushes) instead of masquerading as riders.
      connectSocket(token, role);
    }
  },

  updateUser: (patch) =>
    set((state) => {
      const nextStatus = (patch as Partial<User>).driverStatus;
      return {
        user: state.user ? { ...state.user, ...patch } : state.user,
        // Non-approved users can never sit in driver mode.
        ...(nextStatus !== undefined && nextStatus !== 'approved' ? { activeMode: 'rider' as const } : {}),
      };
    }),

  clearJustLoggedIn: () => set({ justLoggedIn: false }),

  logout: (remote = true) => {
    const state = useAuthStore.getState();
    if (remote && state.accessToken) {
      // Best-effort server revocation; never blocks local logout.
      import('../api/auth').then(({ authApi }) =>
        authApi.logout().catch(() => {}),
      );
    }
    disconnectSocket();
    // D-4: a signed-out driver must not keep the background location service.
    void stopDriverBackgroundLocation();
    tokenManager.clear();
    void saveSecure(ACCESS_KEY, null);
    void saveSecure(REFRESH_KEY, null);
    import('./rideStore')
      .then((m) => m.useRideStore.getState().resetRide())
      .catch(() => {});
    set({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      developmentOtp: null,
      activeMode: 'rider',
      bootOffline: false,
      justLoggedIn: false,
    });
  },

  restoreSession: async () => {
    set({ bootOffline: false });
    try {
      let access: string | null = null;
      let refresh: string | null = null;
      let mode: string | null = null;
      try {
        [access, refresh, mode] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_KEY),
          SecureStore.getItemAsync(REFRESH_KEY),
          SecureStore.getItemAsync(MODE_KEY),
        ]);
      } catch {
        // No secure storage — stay logged out.
      }
      if (access || refresh) {
        tokenManager.setTokens({
          ...(access ? { accessToken: access } : {}),
          ...(refresh ? { refreshToken: refresh } : {}),
        });
      }
      if (mode === 'driver') set({ activeMode: 'driver' });
      if (!access) return;
      // Validate against the server; refresh happens via the 401 interceptor.
      const { authApi } = await import('../api/auth');
      set({ accessToken: access, refreshToken: refresh });
      try {
        const me = await authApi.me();
        const role = me.role ?? 'rider';
        set({
          isAuthenticated: true,
          user: me,
          activeMode: me.driverStatus === 'approved' && mode === 'driver' ? 'driver' : 'rider',
        });
        connectSocket(access, role);
      } catch (e) {
        // Network failure (no response) keeps stored tokens and shows the
        // offline retry screen. A 401 after refresh already logged out, which
        // is the only path to the login flow.
        if (!isHttpResponseError(e)) {
          set({ bootOffline: true });
        }
      }
    } finally {
      set({ hydrated: true });
    }
  },
}));

// No `response` on the error means the request never reached the server
// (airplane mode, dead backend) — as opposed to a 401 rejection.
function isHttpResponseError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'response' in e &&
    typeof (e as { response?: unknown }).response === 'object' &&
    (e as { response?: unknown }).response !== null
  );
}

// Wire tokenManager back without a static import cycle (runtime only).
tokenManager.setOnUnauthorized(() => {
  useAuthStore.getState().logout(false);
});
tokenManager.setOnTokensChanged((t) => {
  useAuthStore.setState({ accessToken: t.accessToken, refreshToken: t.refreshToken });
  // Write a key only when its value is non-null: a partial update (access
  // only) must never delete the stored refresh token.
  if (t.accessToken != null) void saveSecure(ACCESS_KEY, t.accessToken);
  if (t.refreshToken != null) void saveSecure(REFRESH_KEY, t.refreshToken);
  // AU-3: silent refresh → any dormant socket reconnects with the new token
  // (live connections keep their handshake; socket.ts auth is also a callback).
  refreshSocketAuth();
});
