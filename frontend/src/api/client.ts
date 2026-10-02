import axios from 'axios';
import { Platform } from 'react-native';
import { tokenManager } from '../lib/tokenManager';

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

export const api = axios.create({
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
let refreshQueue: Array<(token: string | null) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config as any;
    if (error?.response?.status !== 401 || !original || original._retried) {
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
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; error?: string; statusCode?: number } | undefined;
    const message = data?.message;
    if (Array.isArray(message)) return message.join('\n');
    if (typeof message === 'string' && message) return message;
    if (data?.error) return `${data.error}${data?.statusCode ? ` (${data.statusCode})` : ''}`;
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
