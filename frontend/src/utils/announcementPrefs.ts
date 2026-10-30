/**
 * Audio Announcements preferences (pure part: defaults, parsing, serialising).
 * Storage lives in lib/announcementPrefsStorage.ts so this file stays testable
 * in plain Jest.
 */
export type AnnouncementVolume = 'Soft' | 'Normal' | 'Loud';

export const ANNOUNCEMENT_VOLUMES: readonly AnnouncementVolume[] = ['Soft', 'Normal', 'Loud'];
export const ANNOUNCEMENT_LANGUAGES: readonly string[] = ['English', 'Tamil (\u0ba4\u0bae\u0bbf\u0bb4\u0bcd)', 'Hindi (\u0939\u093f\u0902\u0926\u0940)'];

export interface AnnouncementPrefs {
  voiceAlerts: boolean;
  arrivalChime: boolean;
  speedAlerts: boolean;
  voiceLang: string;
  volume: AnnouncementVolume;
}

export const DEFAULT_ANNOUNCEMENT_PREFS: AnnouncementPrefs = {
  voiceAlerts: true,
  arrivalChime: true,
  speedAlerts: false,
  voiceLang: 'English',
  volume: 'Normal',
};

/** Reads stored JSON; anything missing or invalid falls back to the default for that field. */
export function parseAnnouncementPrefs(raw: string | null | undefined): AnnouncementPrefs {
  if (!raw) return { ...DEFAULT_ANNOUNCEMENT_PREFS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_ANNOUNCEMENT_PREFS };
  }
  if (typeof data !== 'object' || data === null) return { ...DEFAULT_ANNOUNCEMENT_PREFS };
  const d = data as Record<string, unknown>;
  const d0 = DEFAULT_ANNOUNCEMENT_PREFS;
  return {
    voiceAlerts: typeof d.voiceAlerts === 'boolean' ? d.voiceAlerts : d0.voiceAlerts,
    arrivalChime: typeof d.arrivalChime === 'boolean' ? d.arrivalChime : d0.arrivalChime,
    speedAlerts: typeof d.speedAlerts === 'boolean' ? d.speedAlerts : d0.speedAlerts,
    voiceLang:
      typeof d.voiceLang === 'string' && ANNOUNCEMENT_LANGUAGES.includes(d.voiceLang) ? d.voiceLang : d0.voiceLang,
    volume:
      typeof d.volume === 'string' && (ANNOUNCEMENT_VOLUMES as readonly string[]).includes(d.volume)
        ? (d.volume as AnnouncementVolume)
        : d0.volume,
  };
}

export function serializeAnnouncementPrefs(prefs: AnnouncementPrefs): string {
  return JSON.stringify(prefs);
}
