import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SmsProvider, SmsSendResult } from './sms-provider.interface';

/**
 * Real MSG91 integration. Only used when OTP_DEV_MODE=false and
 * MSG91_AUTH_KEY is set. See https://docs.msg91.com/ for the OTP API.
 */
@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  private readonly logger = new Logger(Msg91SmsProvider.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async sendOtp(phone: string, otp: string): Promise<SmsSendResult> {
  const authKey = this.config.get<string>('MSG91_AUTH_KEY');
  const templateId = this.config.get<string>('MSG91_OTP_TEMPLATE_ID');
  const senderId = this.config.get<string>('MSG91_SENDER_ID');

  if (!authKey || !templateId) {
    this.logger.warn('MSG91 credentials not configured; skipping real SMS send.');
    return { sent: false };
  }

  try {
    await firstValueFrom(
      this.http.post('https://control.msg91.com/api/v5/otp', null, {
        params: { mobile: `91${phone}`, otp, template_id: templateId, sender: senderId, authkey: authKey },
      }),
    );
    return { sent: true };
  } catch (err) {
    this.logger.error(`MSG91 send failed for ${phone}`, err as Error);
    throw err;
  }
}
}
