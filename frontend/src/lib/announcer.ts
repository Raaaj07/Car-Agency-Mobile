import { loadAnnouncementPrefs } from './announcementPrefsStorage';
import { AnnouncementPrefs } from '../utils/announcementPrefs';
import {
  AnnouncementEvent,
  AnnouncementParams,
  announcementText,
  languageTag,
  pickVoiceLanguage,
  shouldAnnounce,
  volumeLevel,
} from '../utils/announcements';

/**
 * Speaks the announcements with the phone's text-to-speech (expo-speech).
 * The rules (what to say / when) are pure and tested in utils/announcements.ts.
 *
 * Needs a native build that includes expo-speech. When the module is missing
 * (an older build) nothing is spoken and nothing crashes.
 */
type SpeechModule = typeof import('expo-speech');

/** spoken = said in the chosen language; fallback = said in English because the phone has no voice for it. */
export type SpeakResult = 'spoken' | 'fallback' | 'muted' | 'unavailable';

let speechPromise: Promise<SpeechModule | null> | null = null;
function getSpeech(): Promise<SpeechModule | null> {
  if (!speechPromise) speechPromise = import('expo-speech').catch(() => null);
  return speechPromise;
}

// Languages the phone can speak, read once per app run (null = not read yet).
let voiceLanguages: string[] | null = null;
async function deviceLanguages(speech: SpeechModule): Promise<string[]> {
  if (voiceLanguages) return voiceLanguages;
  try {
    const voices = await speech.getAvailableVoicesAsync();
    voiceLanguages = voices.map((v) => v.language).filter((l): l is string => typeof l === 'string');
  } catch {
    // Some phones cannot list voices: [] means "try the preferred language".
    voiceLanguages = [];
  }
  return voiceLanguages;
}

/**
 * Speaks one announcement. `force` skips the settings gate (the "Play sample"
 * button); `prefs` overrides the saved choices (settings screen, unsaved).
 */
export async function announce(
  event: AnnouncementEvent,
  params: AnnouncementParams = {},
  opts: { prefs?: AnnouncementPrefs; force?: boolean } = {},
): Promise<SpeakResult> {
  try {
    const prefs = opts.prefs ?? (await loadAnnouncementPrefs());
    if (!opts.force && !shouldAnnounce(prefs, event)) return 'muted';
    const speech = await getSpeech();
    if (!speech) return 'unavailable';

    const wanted = languageTag(prefs.voiceLang);
    const languages = await deviceLanguages(speech);
    let key = wanted.key;
    let language = pickVoiceLanguage(languages, key);
    let fellBack = false;
    if (language === null) {
      // No Tamil / Hindi voice installed: English text in an English voice
      // beats Tamil text read out by an English voice.
      key = 'en';
      language = pickVoiceLanguage(languages, 'en') ?? 'en-IN';
      fellBack = true;
    }

    speech.speak(announcementText(event, key, params), {
      language,
      volume: volumeLevel(prefs.volume),
      rate: 0.95,
    });
    return fellBack ? 'fallback' : 'spoken';
  } catch {
    // Speech must never break the ride flow.
    return 'unavailable';
  }
}

// Keys already announced this app run (e.g. "driver_found:<rideId>"). The ride
// store is updated by sockets AND polls, so the same change is seen many times.
const announced = new Set<string>();
const MAX_REMEMBERED = 200;

/** Like announce(), but each `key` is spoken at most once per app run. */
export function announceOnce(key: string, event: AnnouncementEvent, params: AnnouncementParams = {}): void {
  if (announced.has(key)) return;
  if (announced.size >= MAX_REMEMBERED) announced.clear();
  announced.add(key);
  void announce(event, params);
}

/** Cuts off anything being spoken (logout, leaving the app). */
export async function stopAnnouncements(): Promise<void> {
  try {
    const speech = await getSpeech();
    await speech?.stop();
  } catch {
    // nothing to stop
  }
}
