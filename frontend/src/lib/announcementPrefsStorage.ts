import * as SecureStore from 'expo-secure-store';
import {
  AnnouncementPrefs,
  DEFAULT_ANNOUNCEMENT_PREFS,
  parseAnnouncementPrefs,
  serializeAnnouncementPrefs,
} from '../utils/announcementPrefs';

// Stored on this device only (a preference, not account data).
const KEY = 'vazhi.announcementPrefs';

/** Saved preferences, or the defaults (never throws: storage may be unavailable, e.g. Expo Go). */
export async function loadAnnouncementPrefs(): Promise<AnnouncementPrefs> {
  try {
    return parseAnnouncementPrefs(await SecureStore.getItemAsync(KEY));
  } catch {
    return { ...DEFAULT_ANNOUNCEMENT_PREFS };
  }
}

/** True when the preferences were stored. */
export async function saveAnnouncementPrefs(prefs: AnnouncementPrefs): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(KEY, serializeAnnouncementPrefs(prefs));
    return true;
  } catch {
    return false;
  }
}
