import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider, SmsSendResult } from './sms-provider.interface';

@Injectable()
export class DevSmsProvider implements SmsProvider {
  private readonly logger = new Logger('DevSmsProvider');

  async sendOtp(phone: string, otp: string): Promise<SmsSendResult> {
    // Pass-4 (task 13): this provider only exists for local development. In
    // production it must never run — minting a real OTP that gets printed to
    // the logs would be a full account-takeover primitive — so fail loudly.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DevSmsProvider cannot run in production: set OTP_DEV_MODE=false and configure a real SMS provider.',
      );
    }
    // Dev only: prints the OTP so you can sign in without a real SMS gateway.
    this.logger.log(`[DEV OTP] +91${phone} -> ${otp}`);
    return { sent: false }; // dev provider never really sends
  }
}
