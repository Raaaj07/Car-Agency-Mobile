import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider, SmsSendResult } from './sms-provider.interface';

@Injectable()
export class DevSmsProvider implements SmsProvider {
  private readonly logger = new Logger('DevSmsProvider');

  async sendOtp(phone: string, otp: string): Promise<SmsSendResult> {
  this.logger.log(`[DEV OTP] +91${phone} -> ${otp}`);
  return { sent: false }; // dev provider never really sends
}
}
