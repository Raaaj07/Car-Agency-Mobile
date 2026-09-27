import { api } from './client';
import { User } from '../store/authStore';

export type Role = 'rider' | 'driver';

export interface VerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  isNewUser: boolean;
}

export const authApi = {
  sendOtp: async (phone: string) =>
    (await api.post<{ message: string; expiresInSeconds: number; devOtp?: string }>('/auth/otp/send', { phone })).data,
  verifyOtp: async (input: { phone: string; otp: string; role: Role; name?: string }) =>
    (await api.post<VerifyOtpResponse>('/auth/otp/verify', input)).data,
  googleSignIn: async (idToken: string, role: Role) =>
    (await api.post<VerifyOtpResponse>('/auth/google', { idToken, role })).data,
  appleSignIn: async (identityToken: string, fullName: string | undefined, role: Role) =>
    (await api.post<VerifyOtpResponse>('/auth/apple', { identityToken, fullName, role })).data,
  me: async () => (await api.get<User>('/auth/me')).data,
  updateMe: async (patch: { name?: string; email?: string }) =>
    (await api.patch<User>('/auth/me', patch)).data, // ADD
};