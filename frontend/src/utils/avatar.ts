import { API_URL } from '../api/client';

/**
 * Turns an avatar value from the API into a URI an <Image> can load.
 *
 *  - `https://…` (Cloudinary) and `data:` URLs pass through untouched;
 *  - API-relative paths (`/users/<id>/avatar`) get prefixed with `API_URL`
 *    (which already includes `/api/v1`);
 *  - a legacy `/api/v1/…` prefix from older backend builds is stripped first
 *    so old and new server responses both resolve to exactly one `/api/v1`.
 *
 * Returns undefined when there is no usable photo (caller falls back to
 * initials) — bare local file names are no longer produced by the backend.
 */
export function resolveAvatarUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^(https?:|data:)/i.test(value)) return value;
  if (value.startsWith('/')) {
    const path = value.replace(/^\/api\/v1(?=\/)/, '');
    return `${API_URL}${path}`;
  }
  return undefined;
}
