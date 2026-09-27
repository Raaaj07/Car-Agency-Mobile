export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsSendResult {
  sent: boolean;
}

export interface SmsProvider {
  sendOtp(phone: string, otp: string): Promise<SmsSendResult>;
}