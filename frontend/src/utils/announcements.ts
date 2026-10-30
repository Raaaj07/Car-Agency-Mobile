/**
 * Voice announcements: the pure rules (what to say, in which language, when).
 * No React, React Native or Expo imports, so all of it runs in plain Jest.
 * Speaking itself lives in lib/announcer.ts (expo-speech).
 *
 * What the app announces:
 *  - Rider: driver found, driver arriving, trip started, trip finished
 *    (with the fare), ride cancelled, no drivers available.
 *  - Driver: a new ride request, a cancelled ride, a slow-down warning.
 *
 * The app has NO turn-by-turn engine (drivers navigate in Google Maps), so
 * there are no spoken directions.
 */
import type { AnnouncementPrefs } from './announcementPrefs';

export type AnnouncementEvent =
  | 'driver_found'
  | 'driver_arriving'
  | 'trip_started'
  | 'trip_completed'
  | 'ride_cancelled'
  | 'no_drivers'
  | 'new_request'
  | 'request_cancelled'
  | 'slow_down';

export interface AnnouncementParams {
  driverName?: string;
  /** Total fare in rupees. */
  fare?: number;
  /** Trip distance in km. */
  km?: number;
}

export type VoiceKey = 'en' | 'ta' | 'hi';

const PREFERRED_TAG: Record<VoiceKey, string> = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN' };

/** The language chip chosen in settings -> voice key + preferred language tag. */
export function languageTag(pref: string): { key: VoiceKey; tag: string } {
  const key: VoiceKey = pref.startsWith('Tamil') ? 'ta' : pref.startsWith('Hindi') ? 'hi' : 'en';
  return { key, tag: PREFERRED_TAG[key] };
}

/**
 * Picks the device voice language to use for `key` from the languages the
 * phone's text-to-speech reports (e.g. ['en-US', 'ta-IN']).
 * Exact preferred tag first, then any voice of that language; null when the
 * phone has none. An empty list means the phone could not tell: trust the
 * preferred tag and try it.
 */
export function pickVoiceLanguage(available: string[], key: VoiceKey): string | null {
  if (available.length === 0) return PREFERRED_TAG[key];
  const normalised = available.map((l) => l.replace('_', '-'));
  const preferred = PREFERRED_TAG[key].toLowerCase();
  const exact = normalised.find((l) => l.toLowerCase() === preferred);
  if (exact) return exact;
  const sameLanguage = normalised.find((l) => l.toLowerCase().split('-')[0] === key);
  return sameLanguage ?? null;
}

/** Soft / Normal / Loud -> expo-speech volume (0 to 1). The phone's media volume still applies. */
export function volumeLevel(volume: string): number {
  if (volume === 'Soft') return 0.4;
  if (volume === 'Loud') return 1;
  return 0.8;
}

function rupees(fare: number | undefined): number | null {
  return fare != null && Number.isFinite(fare) && fare >= 0 ? Math.round(fare) : null;
}

function kilometres(km: number | undefined): string | null {
  return km != null && Number.isFinite(km) && km > 0 ? km.toFixed(1) : null;
}

/** The sentence to speak. Every event has English, Tamil and Hindi text. */
export function announcementText(event: AnnouncementEvent, key: VoiceKey, params: AnnouncementParams = {}): string {
  const name = params.driverName?.trim() || '';
  const fare = rupees(params.fare);
  const km = kilometres(params.km);

  if (key === 'ta') {
    switch (event) {
      case 'driver_found':
        return name
          ? `உங்கள் ஓட்டுநர் ${name} வந்து கொண்டிருக்கிறார்.`
          : 'உங்கள் ஓட்டுநர் வந்து கொண்டிருக்கிறார்.';
      case 'driver_arriving':
        return 'உங்கள் ஓட்டுநர் அருகில் வந்துவிட்டார்.';
      case 'trip_started':
        return 'உங்கள் பயணம் தொடங்கியது. பாதுகாப்பான பயணம்.';
      case 'trip_completed':
        return fare != null
          ? `நீங்கள் சேரும் இடத்தை அடைந்துவிட்டீர்கள். மொத்தக் கட்டணம் ${fare} ரூபாய்.`
          : 'நீங்கள் சேரும் இடத்தை அடைந்துவிட்டீர்கள்.';
      case 'ride_cancelled':
        return 'உங்கள் பயணம் ரத்து செய்யப்பட்டது.';
      case 'no_drivers':
        return 'மன்னிக்கவும், தற்போது ஓட்டுநர்கள் யாரும் இல்லை.';
      case 'new_request':
        return `புதிய சவாரி கோரிக்கை.${km ? ` ${km} கிலோமீட்டர்.` : ''}${fare != null ? ` கட்டணம் ${fare} ரூபாய்.` : ''}`;
      case 'request_cancelled':
        return 'இந்த சவாரி ரத்து செய்யப்பட்டது.';
      case 'slow_down':
        return 'தயவுசெய்து வேகத்தைக் குறைக்கவும்.';
    }
  }

  if (key === 'hi') {
    switch (event) {
      case 'driver_found':
        return name ? `आपका ड्राइवर ${name} आ रहा है।` : 'आपका ड्राइवर आ रहा है।';
      case 'driver_arriving':
        return 'आपका ड्राइवर पहुँचने वाला है।';
      case 'trip_started':
        return 'आपकी यात्रा शुरू हो गई है। सुरक्षित यात्रा।';
      case 'trip_completed':
        return fare != null
          ? `आप अपनी मंज़िल पर पहुँच गए हैं। कुल किराया ${fare} रुपये।`
          : 'आप अपनी मंज़िल पर पहुँच गए हैं।';
      case 'ride_cancelled':
        return 'आपकी राइड रद्द कर दी गई है।';
      case 'no_drivers':
        return 'क्षमा करें, अभी कोई ड्राइवर उपलब्ध नहीं है।';
      case 'new_request':
        return `नई राइड रिक्वेस्ट।${km ? ` ${km} किलोमीटर।` : ''}${fare != null ? ` किराया ${fare} रुपये।` : ''}`;
      case 'request_cancelled':
        return 'यह राइड रद्द कर दी गई है।';
      case 'slow_down':
        return 'कृपया गति धीमी करें।';
    }
  }

  switch (event) {
    case 'driver_found':
      return name ? `Your driver ${name} is on the way.` : 'Your driver is on the way.';
    case 'driver_arriving':
      return 'Your driver is arriving.';
    case 'trip_started':
      return 'Your trip has started. Have a safe journey.';
    case 'trip_completed':
      return fare != null
        ? `You have reached your destination. The total fare is ${fare} rupees.`
        : 'You have reached your destination.';
    case 'ride_cancelled':
      return 'Your ride was cancelled.';
    case 'no_drivers':
      return 'Sorry, no drivers are available right now.';
    case 'new_request':
      return `New ride request.${km ? ` ${km} kilometres.` : ''}${fare != null ? ` Fare ${fare} rupees.` : ''}`;
    case 'request_cancelled':
      return 'This ride was cancelled.';
    case 'slow_down':
      return 'Please slow down.';
  }
}

/**
 * Settings gate. "Voice announcements" is the master switch for everything;
 * the arrival alert and the over-speed warning also need their own switch.
 */
export function shouldAnnounce(prefs: AnnouncementPrefs, event: AnnouncementEvent): boolean {
  if (!prefs.voiceAlerts) return false;
  if (event === 'driver_arriving') return prefs.arrivalChime;
  if (event === 'slow_down') return prefs.speedAlerts;
  return true;
}

// ── Ride status changes -> announcements ────────────────────────────────────

/** The few ride fields the rules look at (ActiveRide satisfies this). */
export interface RideLike {
  id: string;
  status: string;
  source?: string;
  cancellationReason?: string | null;
  driver?: { name?: string | null } | null;
  fareBreakdown?: { total?: number | string | null } | null;
  distanceKm?: string | null;
}

export interface RideSnapshot {
  id: string;
  status: string;
  source?: string;
  cancellationReason?: string | null;
  driverName?: string;
  fare?: number;
  km?: number;
}

export function snapshotRide(ride: RideLike | null | undefined): RideSnapshot | null {
  if (!ride) return null;
  const total = ride.fareBreakdown?.total;
  const fare = total == null ? Number.NaN : Number(total);
  const km = ride.distanceKm == null ? Number.NaN : Number(ride.distanceKm);
  return {
    id: ride.id,
    status: ride.status,
    source: ride.source,
    cancellationReason: ride.cancellationReason,
    driverName: ride.driver?.name?.trim() || undefined,
    fare: Number.isFinite(fare) ? fare : undefined,
    km: Number.isFinite(km) ? km : undefined,
  };
}

export interface DetectedAnnouncement {
  event: AnnouncementEvent;
  rideId: string;
  params: AnnouncementParams;
}

const ACTIVE = ['requested', 'matched', 'driver_en_route', 'in_progress'];

/**
 * Compares the previous and the new state of the ride in the store and returns
 * what to announce, if anything. A ride seen for the FIRST time (a booking just
 * made, or one restored after the app was killed) is never announced: only
 * changes the person watches happen are.
 */
export function detectRideAnnouncement(
  prev: RideSnapshot | null,
  next: RideSnapshot | null,
  role: 'rider' | 'driver',
): DetectedAnnouncement | null {
  if (!next) return null;
  const sameRide = prev?.id === next.id;

  if (role === 'driver') {
    // A new offer on this phone (never the user's own rider booking).
    if (next.status === 'requested' && next.source !== 'rider-restore' && !sameRide) {
      return { event: 'new_request', rideId: next.id, params: { fare: next.fare, km: next.km } };
    }
    return null;
  }

  if (!prev || !sameRide) return null;
  const was = prev.status;
  switch (next.status) {
    case 'matched':
    case 'driver_en_route':
      if (was === 'requested') {
        return { event: 'driver_found', rideId: next.id, params: { driverName: next.driverName } };
      }
      return null;
    case 'in_progress':
      if (was === 'requested' || was === 'matched' || was === 'driver_en_route') {
        return { event: 'trip_started', rideId: next.id, params: {} };
      }
      return null;
    case 'completed':
      if (ACTIVE.includes(was)) {
        return { event: 'trip_completed', rideId: next.id, params: { fare: next.fare } };
      }
      return null;
    case 'cancelled':
      if (ACTIVE.includes(was)) {
        return {
          event: next.cancellationReason === 'no_drivers_available' ? 'no_drivers' : 'ride_cancelled',
          rideId: next.id,
          params: {},
        };
      }
      return null;
    default:
      return null;
  }
}

// ── Thresholds ──────────────────────────────────────────────────────────────

/** The driver is this close to the pickup (metres) or this few seconds away: "arriving". */
export const ARRIVING_DISTANCE_METERS = 300;
export const ARRIVING_ETA_SECONDS = 60;

export function isDriverArriving(distanceMeters: number | null | undefined, etaSeconds: number | null | undefined): boolean {
  if (distanceMeters != null && Number.isFinite(distanceMeters) && distanceMeters <= ARRIVING_DISTANCE_METERS) return true;
  if (etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds <= ARRIVING_ETA_SECONDS) return true;
  return false;
}

/** There is no road speed-limit data in the app, so one fixed limit is used. */
export const SPEED_WARNING_KMH = 80;
/** Do not repeat the warning more often than this. */
export const SPEED_WARNING_COOLDOWN_MS = 30_000;

export function shouldWarnSpeed(
  speedKmh: number | null | undefined,
  nowMs: number,
  lastWarnMs: number,
  limitKmh = SPEED_WARNING_KMH,
  cooldownMs = SPEED_WARNING_COOLDOWN_MS,
): boolean {
  if (speedKmh == null || !Number.isFinite(speedKmh)) return false;
  if (speedKmh <= limitKmh) return false;
  return nowMs - lastWarnMs >= cooldownMs;
}
