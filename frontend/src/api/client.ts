import axios from 'axios';
import { Platform } from 'react-native';
import { useAuthStore } from '../store/authStore';

// Set EXPO_PUBLIC_API_URL for a physical device (for example,
// http://192.168.1.20:3000/api/v1). Android emulators can reach the host
// through 10.0.2.2; browsers and iOS simulators use localhost by default.
const fallbackBaseUrl = Platform.OS === 'android'
  ? 'http://10.0.2.2:3000/api/v1'
  : 'http://localhost:3000/api/v1';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || fallbackBaseUrl).replace(/\/$/, '');

export const api = axios.create({
  baseURL: API_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function getApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    return Array.isArray(message) ? message.join('\n') : message || error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
