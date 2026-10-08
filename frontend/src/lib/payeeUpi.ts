import * as SecureStore from 'expo-secure-store';
import { driversApi } from '../api/drivers';
import { getApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { isValidUpiId } from '../utils/upi';

/**
 * The driver's payee UPI ID (the account the ride-payment QR pays to).
 *
 * Source of truth is the server (driver profile `upiVpa`: validated, audited,
 * visible to admins). A per-user copy is cached in SecureStore so the QR can
 * still be generated offline.
 *
 * The cache key includes the user id. It used to be one device-wide key, so on
 * a shared phone the NEXT driver's QR could silently pay the PREVIOUS driver's
 * UPI account. SecureStore keys only allow [A-Za-z0-9._-], hence the `_`.
 */
function cacheKey(): string | null {
  const id = useAuthStore.getState().user?.id;
  return id ? `driver_upi_id_${id}` : null;
}

async function readCache(): Promise<string | null> {
  const key = cacheKey();
  if (!key) return null;
  try {
    const v = (await SecureStore.getItemAsync(key))?.trim();
    return v && isValidUpiId(v) ? v : null;
  } catch {
    return null;
  }
}

async function writeCache(vpa: string): Promise<void> {
  const key = cacheKey();
  if (!key) return;
  try {
    await SecureStore.setItemAsync(key, vpa);
  } catch {
    // SecureStore unavailable (Expo Go) — the server copy still stands.
  }
}

export interface PayeeUpiResult {
  vpa: string | null;
  /** true when the value came from the server (false = offline cache / none). */
  fromServer: boolean;
}

/** Server value first; device cache only when the server can't be reached or has none. */
export async function loadPayeeUpi(): Promise<PayeeUpiResult> {
  let serverVpa: string | null = null;
  let reached = false;
  try {
    const profile = await driversApi.getMyProfile();
    reached = true;
    const v = profile?.upiVpa?.trim();
    serverVpa = v && isValidUpiId(v) ? v : null;
  } catch {
    // offline — fall through to the cache
  }

  if (serverVpa) {
    void writeCache(serverVpa);
    return { vpa: serverVpa, fromServer: true };
  }

  const cached = await readCache();
  if (cached && reached) {
    // The driver saved it on this device before it could be stored on their
    // profile (e.g. before approval) — promote it so admins can see it too.
    driversApi.setUpiVpa(cached).catch(() => {});
  }
  return { vpa: cached, fromServer: false };
}

export type SavePayeeUpiResult =
  | { ok: true; vpa: string }
  | { ok: false; error: string };

/**
 * Validates and stores the UPI ID on the profile. Unlike the old payment-screen
 * code this does NOT swallow a server failure: the caller must know whether
 * the ID was really saved (a silent failure meant admin saw a different/empty
 * payee than the QR the driver was showing).
 */
export async function savePayeeUpi(raw: string): Promise<SavePayeeUpiResult> {
  const vpa = raw.trim();
  if (!isValidUpiId(vpa)) {
    return { ok: false, error: 'Enter a valid UPI ID like name@bank' };
  }
  try {
    const saved = await driversApi.setUpiVpa(vpa);
    const stored = saved?.upiVpa?.trim() || vpa;
    await writeCache(stored);
    return { ok: true, vpa: stored };
  } catch (err) {
    return { ok: false, error: getApiError(err) };
  }
}
