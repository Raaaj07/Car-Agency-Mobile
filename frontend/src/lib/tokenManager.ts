// Single source of truth for auth tokens outside React/Zustand.
// Exists to break the require cycle:
//   authStore -> socket -> client -> authStore
// client.ts and socket.ts use only this module (no store imports).
//
// The key names are exported because three runtimes read/write them:
// the main bundle (authStore), the axios interceptor (client.ts adoption),
// and the headless location task (lib/locationTask.ts, D-4).

export const ACCESS_TOKEN_KEY = 'vazhi.accessToken';
export const REFRESH_TOKEN_KEY = 'vazhi.refreshToken';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onTokensChanged: ((t: { accessToken: string | null; refreshToken: string | null }) => void) | null = null;

export const tokenManager = {
  getAccessToken: () => accessToken,
  getRefreshToken: () => refreshToken,
  setTokens: (next: { accessToken?: string | null; refreshToken?: string | null }) => {
    if (next.accessToken !== undefined) accessToken = next.accessToken;
    if (next.refreshToken !== undefined) refreshToken = next.refreshToken;
    onTokensChanged?.({ accessToken, refreshToken });
  },
  clear: () => {
    accessToken = null;
    refreshToken = null;
  },
  setOnUnauthorized: (fn: (() => void) | null) => {
    onUnauthorized = fn;
  },
  setOnTokensChanged: (fn: ((t: { accessToken: string | null; refreshToken: string | null }) => void) | null) => {
    onTokensChanged = fn;
  },
  handleUnauthorized: () => {
    onUnauthorized?.();
  },
};
