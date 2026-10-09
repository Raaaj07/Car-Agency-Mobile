import axios, { create as axiosCreate, isAxiosError } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, tokenManager } from '../lib/tokenManager';

// Set EXPO_PUBLIC_API_URL for a physical device (for example,
// http://192.168.1.20:3000/api/v1). Android emulators can reach the host
// through 10.0.2.2; browsers and iOS simulators use localhost by default.
const fallbackBaseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000/api/v1' : 'http://localhost:3000/api/v1';

const rawUrl = process.env.EXPO_PUBLIC_API_URL || fallbackBaseUrl;
if (!process.env.EXPO_PUBLIC_API_URL && __DEV__) {
  console.warn(`[api] EXPO_PUBLIC_API_URL not set, using fallback ${fallbackBaseUrl}`);
}

export const API_URL = rawUrl.replace(/\/$/, '');

export const api = axiosCreate({
  baseURL: API_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenManager.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 -> try refresh token once, then retry original request.
let isRefreshing = false;
let refreshQueue: ((token: string | null) => void)[] = [];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config as any;
    if (error?.response?.status !== 401 || !original) {
      return Promise.reject(error);
    }

    // D-4: the headless location task may have rotated tokens while the app
    // was backgrounded — refresh tokens are single-use, so our in-memory pair
    // could be revoked. Adopt the stored pair first (always the newest) before
    // attempting our own refresh. No-op in the normal case: stored access ==
    // ours, so nothing changes and the flow below runs as before.
    if (!original._adoptedTokens) {
      original._adoptedTokens = true;
      try {
        const storedAccess = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
        const storedRefresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
        if (storedAccess && storedAccess !== tokenManager.getAccessToken()) {
          tokenManager.setTokens({
            accessToken: storedAccess,
            refreshToken: storedRefresh ?? undefined,
          });
          original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${storedAccess}` };
          return api(original);
        }
      } catch {
        // SecureStore unavailable — fall through to the standard refresh.
      }
    }

    if (original._retried) {
      return Promise.reject(error);
    }
    original._retried = true;
    const refreshToken = tokenManager.getRefreshToken();
    if (!refreshToken) return Promise.reject(error);

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((token) => {
          if (!token) return reject(error);
          original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${token}` };
          resolve(api(original));
        });
      });
    }

    isRefreshing = true;
    try {
      const res = await axios.post(`${API_URL}/auth/refresh`, { refreshToken }, { timeout: 10_000 });
      const { accessToken: next, refreshToken: nextRefresh } = res.data ?? {};
      if (!next) throw new Error('refresh failed');
      tokenManager.setTokens({ accessToken: next, ...(nextRefresh ? { refreshToken: nextRefresh } : {}) });
      refreshQueue.forEach((fn) => fn(next));
      refreshQueue = [];
      original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${next}` };
      return api(original);
    } catch (e) {
      refreshQueue.forEach((fn) => fn(null));
      refreshQueue = [];
      // Token dead — authStore registered onUnauthorized -> logout.
      tokenManager.handleUnauthorized();
      return Promise.reject(error ?? e);
    } finally {
      isRefreshing = false;
    }
  },
);

export function getApiError(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; error?: string; statusCode?: number } | undefined;
    const message = data?.message;
    if (Array.isArray(message)) return message.join('\n');
    if (typeof message === 'string' && message) return message;
    if (data?.error) return `${data.error}${data?.statusCode ? ` (${data.statusCode})` : ''}`;
    // No HTTP response at all = the request never reached the server. Say so in
    // plain words instead of axios' bare "Network Error" / "timeout of 15000ms",
    // which gave a tester no clue whether the phone, the network or the
    // server was at fault.
    if (!error.response) {
      if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return 'The server is taking too long to respond (it may be waking up). Please wait a moment and try again.';
      }
      return `Can't reach the server at ${API_URL}. Check your internet connection and try again.`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
