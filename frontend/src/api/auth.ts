import { api } from './client';
import { User } from '../store/authStore';

export interface VerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  isNewUser: boolean;
}

export const authApi = {
  sendOtp: async (phone: string) =>
    // 60 s (not the global 15 s): a free-tier Render server that has been idle
    // needs 30-60 s to wake up, so the first OTP request of the day used to
    // time out and the user never got a (dev) OTP.
    (
      await api.post<{ message: string; expiresInSeconds: number; otpLength?: number; devOtp?: string }>(
        '/auth/otp/send',
        { phone },
        { timeout: 60_000 },
      )
    ).data,
  verifyOtp: async (input: { phone: string; otp: string; name?: string }) =>
    (await api.post<VerifyOtpResponse>('/auth/otp/verify', input)).data,
  // 60 s (not the global 15 s) for the same reason as sendOtp: an idle
  // free-tier Render server needs 30-60 s to wake, and a timed-out sign-in
  // used to look like "it just doesn't log in".
  googleSignIn: async (idToken: string) =>
    (await api.post<VerifyOtpResponse>('/auth/google', { idToken }, { timeout: 60_000 })).data,
  appleSignIn: async (identityToken: string, fullName?: string) =>
    (
      await api.post<VerifyOtpResponse>(
        '/auth/apple',
        { identityToken, fullName },
        { timeout: 60_000 },
      )
    ).data,
  me: async () => (await api.get<User>('/auth/me')).data,
  // Pass-4 (task 11): explicit refresh for the refresh-only cold-start path
  // (access token missing/expired+cleared, refresh still stored). The axios
  // interceptor would normally drive this via a 401, but on restore there is
  // no access token to send, so we refresh up front. New tokens land in
  // tokenManager via setTokens (onTokensChanged wiring).
  refresh: async (refreshToken: string) =>
    (
      await api.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
        refreshToken,
      })
    ).data,
  updateMe: async (patch: { name?: string; email?: string }) =>
    (await api.patch<User>('/auth/me', patch)).data,
  // Pass-4 (task 12): compliance account deletion. The server anonymises the
  // row (no PII remains) and frees the phone number for re-sign-up, so after
  // this returns there is nothing left to revoke — call logout(false).
  // Returns the 409 message cleanly via getApiError when an active ride blocks it.
  deleteMe: async () => (await api.delete('/auth/me')).data as { ok: true },
  uploadAvatar: async (file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('avatar', file as any);
    return (
      await api.post<User>('/auth/me/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      })
    ).data;
  },
  // Sends the refresh token so the server ends THIS device's session only
  // (other devices stay signed in). Tokens that carry a session id make the
  // body redundant, but older sessions still need it.
  // The access token is passed explicitly: the store clears tokenManager right
  // after calling this, so the request interceptor would otherwise send no
  // Authorization header and the server would never revoke anything.
  logout: async (refreshToken?: string, accessToken?: string) =>
    (
      await api.post(
        '/auth/logout',
        refreshToken ? { refreshToken } : {},
        accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
      )
    ).data,
  // Ends every session of this account ("log out everywhere").
  logoutEverywhere: async () => (await api.post('/auth/logout-everywhere')).data as { ok: true },
};