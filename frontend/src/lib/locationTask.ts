import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Alert } from 'react-native';
import { API_URL } from '../api/client';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from './tokenManager';

/**
 * D-4: OS-level location heartbeat while the driver is online.
 *
 * The old foreground `setInterval` in DriverDashboardScreen dies the moment
 * the app is backgrounded or the screen locks, so drivers silently dropped off
 * the map mid-shift. `Location.startLocationUpdatesAsync` keeps delivering
 * fixes in the background (Android foreground-service notification, iOS
 * `location` background mode — configured via the expo-location plugin in
 * app.json, which requires a dev/EAS build; Expo Go Android has no TaskManager
 * and every call below degrades to a no-op).
 *
 * This module is imported for side effects from App.tsx: `defineTask` MUST run
 * at global scope (top-level of the bundle) so the headless runtime can find
 * the handler when the OS spins the app up for a location event.
 *
 * Token flow: the headless runtime has no axios interceptor and its own
 * SecureStore view. Refresh tokens are single-use server-side, so after a
 * headless rotation SecureStore holds the newest pair — client.ts adopts it on
 * the next 401 instead of refreshing with a revoked token (see the
 * `_adoptedTokens` stage in api/client.ts).
 */
export const DRIVER_LOCATION_TASK = 'driver-location-heartbeat';

interface HeartbeatCoords {
  lat: number;
  lng: number;
}

TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    // Transient location error — the next fix retries.
    return;
  }
  const locations = (
    data as { locations?: { coords: { latitude: number; longitude: number } }[] } | undefined
  )?.locations;
  if (!locations || locations.length === 0) return;
  const last = locations[locations.length - 1];
  // Awaited on purpose: the headless runtime can terminate as soon as the
  // task function settles, so a fire-and-forget fetch would be killed.
  await pushHeartbeat({ lat: last.coords.latitude, lng: last.coords.longitude });
});

/** PATCH /drivers/location with the stored token; refresh once on 401. */
async function pushHeartbeat(coords: HeartbeatCoords): Promise<void> {
  try {
    let token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    if (!token) return; // signed out — nothing to heartbeat
    const first = await patchLocation(token, coords);
    if (first.status !== 401) return;
    token = await refreshTokens();
    if (!token) return;
    await patchLocation(token, coords);
  } catch {
    // Headless: swallow — the next location fix retries.
  }
}

async function patchLocation(token: string, coords: HeartbeatCoords): Promise<Response> {
  return fetch(`${API_URL}/drivers/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
  });
}

/**
 * Rotate tokens from the headless runtime and persist them. SecureStore is
 * the cross-runtime mailbox: client.ts adopts whatever is written here on the
 * main runtime's next 401, so the single-use refresh token never forks.
 */
async function refreshTokens(): Promise<string | null> {
  try {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
    if (!data.accessToken) return null;
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
    if (data.refreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

/**
 * Start background location updates (best-effort, idempotent). Returns false
 * when unsupported (Expo Go Android), background permission is missing, or the
 * OS rejects registration — the foreground interval remains the fallback.
 */
export async function startDriverBackgroundLocation(): Promise<boolean> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return false;
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.status !== 'granted') return false;
    if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // Backend freshness window is 90s (geo.service sweep); 10s keeps the
      // driver solidly fresh without draining the battery in the foreground.
      timeInterval: 10_000,
      distanceInterval: 25,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Vazhi driver',
        notificationBody: 'Sharing your location while you are on duty',
        killServiceOnDestroy: true,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Stop background updates if they are running (safe to call when not). */
export async function stopDriverBackgroundLocation(): Promise<void> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return;
    if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    }
  } catch {
    // Nothing to stop.
  }
}

/**
 * D-4: one-time, non-blocking nudge on the driver's first go-online of the
 * session — background tracking is what keeps them on the map while the phone
 * is locked. Declining is fine: the foreground heartbeat still runs.
 */
export async function promptBackgroundLocationOnce(): Promise<boolean> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return false;
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status === 'granted') return true;

    const wantsEnable = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Stay on the map when your screen locks',
        'Riders can only find you while your location is being shared. Allow location all the time so you keep receiving trips when the app is in the background.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Enable', onPress: () => resolve(true) },
        ],
      );
    });
    if (!wantsEnable) return false;

    const result = await Location.requestBackgroundPermissionsAsync();
    if (result.status !== 'granted') return false;
    // Register right away so the grant takes effect without toggling online.
    await startDriverBackgroundLocation();
    return true;
  } catch {
    return false;
  }
}
