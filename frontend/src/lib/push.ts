import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { api } from '../api/client';

/**
 * Push notifications (Expo). Everything here is best-effort and must never
 * throw into the app: Expo Go on Android has no remote push, simulators have
 * no token, and the user may deny the permission — all of those simply mean
 * "no push", and the app works exactly as before (live updates still arrive
 * over the socket while the app is open).
 *
 * expo-notifications / expo-device are loaded lazily so a build without the
 * native module degrades instead of crashing at import time.
 */
const TOKEN_KEY = 'vazhi.pushToken';

async function loadModules() {
  try {
    const [Notifications, Device] = await Promise.all([import('expo-notifications'), import('expo-device')]);
    return { Notifications, Device };
  } catch {
    return null;
  }
}

/** Show alerts while the app is in the foreground too. Call once at startup. */
export async function configurePushHandler(): Promise<void> {
  const mods = await loadModules();
  if (!mods) return;
  mods.Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Asks permission, fetches the Expo token and registers it for this login. */
export async function registerForPush(): Promise<string | null> {
  try {
    const mods = await loadModules();
    if (!mods) return null;
    const { Notifications, Device } = mods;
    if (!Device.isDevice) return null; // simulators cannot receive push

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Ride updates',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    await api.post('/notifications/token', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch {
      /* storage unavailable — server still cleans dead tokens */
    }
    return token;
  } catch {
    return null; // Expo Go / no FCM credentials / offline — all non-fatal
  }
}

/**
 * Detach this device from the account on logout. The access token is passed
 * explicitly because the caller clears tokenManager right after calling this.
 */
export async function unregisterPush(accessToken: string): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    await api.delete('/notifications/token', {
      data: { token },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Best effort: the server drops the token when Expo reports it dead.
  }
}

export const pushPrefsApi = {
  get: async () => (await api.get<{ enabled: boolean }>('/notifications/preferences')).data,
  set: async (enabled: boolean) => (await api.put<{ enabled: boolean }>('/notifications/preferences', { enabled })).data,
};
