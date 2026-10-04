/**
 * Normalizes a `users.avatar` value into something a React Native `<Image>`
 * can actually load:
 *
 *  - `https://…` (Cloudinary, social sign-in) and `data:` URLs pass through;
 *  - anything else is a legacy local file name and maps to the avatar
 *    endpoint. The path is returned RELATIVE TO THE API BASE (the frontend
 *    prefixes `API_URL`, which already includes `/api/v1`) — previously this
 *    returned `/api/v1/...` and clients produced `/api/v1/api/v1/...` 404s.
 *
 * The endpoint itself is public: profile pictures are shown to other users
 * (rider sees the driver, driver sees the rider) and `<Image>` cannot attach
 * an Authorization header. Paths stay unguessable (uuid-keyed).
 */
export function toAvatarUrl(
  userId: string | null | undefined,
  avatar: string | null | undefined,
): string | null {
  if (!avatar || !userId) return null;
  if (/^(https?:|data:)/i.test(avatar)) return avatar;
  return `/users/${userId}/avatar`;
}
