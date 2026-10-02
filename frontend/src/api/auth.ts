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
    (await api.post<{ message: string; expiresInSeconds: number; devOtp?: string }>('/auth/otp/send', { phone })).data,
  verifyOtp: async (input: { phone: string; otp: string; name?: string }) =>
    (await api.post<VerifyOtpResponse>('/auth/otp/verify', input)).data,
  googleSignIn: async (idToken: string) =>
    (await api.post<VerifyOtpResponse>('/auth/google', { idToken })).data,
  appleSignIn: async (identityToken: string, fullName?: string) =>
    (await api.post<VerifyOtpResponse>('/auth/apple', { identityToken, fullName })).data,
  me: async () => (await api.get<User>('/auth/me')).data,
  updateMe: async (patch: { name?: string; email?: string }) =>
    (await api.patch<User>('/auth/me', patch)).data,
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
  logout: async () => (await api.post('/auth/logout')).data,
};