import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { StorageService } from '../drivers/storage.service';
import { AuthService } from './auth.service';
import { UserEntity } from './entities/user.entity';
import { OtpService } from './otp.service';
import { SmsProvider } from './providers/sms-provider.interface';
import { TokensService } from './tokens.service';

/**
 * SEC-1: admin promotion through OTP login requires a code that is not
 * practically brute-forceable, and POST /auth/otp/send reports otpLength so
 * the app can render that many boxes.
 */
describe('AuthService', () => {
  let service: AuthService;
  let users: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let otp: {
    verify: jest.Mock;
    assertCanSend: jest.Mock;
    issue: jest.Mock;
    otpLength: number;
  };
  let warnSpy: jest.SpyInstance;

  const adminPhone = '9876543210';

  // Fresh object per test — promotion mutates role, so shared state would
  // leak an admin into the "stays rider" assertions. Overrides are applied
  // BEFORE the toFrontendUser closure captures the object, so the method
  // always reflects this instance's current state.
  const makeRider = (overrides: { role?: string; phone?: string } = {}) => {
    const user = {
      id: 'u-1',
      phone: overrides.phone ?? adminPhone,
      name: 'Owner',
      role: overrides.role ?? 'rider',
      language: 'en',
      profileComplete: true,
      avatar: null as string | null,
      toFrontendUser: () => ({
        id: 'u-1',
        phone: user.phone,
        name: 'Owner',
        role: user.role,
        language: 'en',
        profileComplete: true,
      }),
    };
    return user;
  };

  const adminUpdateCalls = () =>
    users.update.mock.calls.filter((c: unknown[]) => (c[1] as { role?: string })?.role === 'admin');

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    users = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation(async (u: unknown) => u),
      create: jest.fn().mockImplementation((u: unknown) => u),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    otp = {
      verify: jest.fn().mockResolvedValue({ ok: true }),
      assertCanSend: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn().mockResolvedValue('1234'),
      otpLength: 4,
    };
    const configGet = jest.fn().mockImplementation((key: string) => {
      if (key === 'ADMIN_PHONES') return adminPhone;
      return undefined;
    });
    service = new AuthService(
      users as unknown as Repository<UserEntity>,
      { findOne: jest.fn().mockResolvedValue(null) } as unknown as Repository<DriverEntity>,
      otp as unknown as OtpService,
      {
        issueTokens: jest.fn().mockReturnValue({ accessToken: 'a', refreshToken: 'r' }),
      } as unknown as TokensService,
      { sendOtp: jest.fn().mockResolvedValue(undefined) } as unknown as SmsProvider,
      { get: configGet } as unknown as ConfigService,
      {} as unknown as JwtService,
      {} as unknown as StorageService,
    );
  });

  afterEach(() => warnSpy.mockRestore());

  describe('admin promotion at OTP login (SEC-1)', () => {
    it('promotes an ADMIN_PHONES phone when the login used a 6-digit OTP', async () => {
      users.findOne.mockResolvedValue(makeRider());

      const result = await service.verifyOtp({ phone: adminPhone, otp: '123456' });

      expect(users.update).toHaveBeenCalledWith({ id: 'u-1' }, { role: 'admin' });
      expect(result.user.role).toBe('admin');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('refuses promotion through a short (4-digit) OTP and only warns', async () => {
      users.findOne.mockResolvedValue(makeRider());

      const result = await service.verifyOtp({ phone: adminPhone, otp: '1234' });

      // Login itself still works — the user just stays a rider.
      expect(result.accessToken).toBe('a');
      expect(adminUpdateCalls()).toHaveLength(0);
      expect(result.user.role).toBe('rider');
      // Warning carries the reason, never the phone number.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OTP length 4 < 6'));
      expect(warnSpy).toHaveBeenCalledWith(expect.not.stringContaining(adminPhone));
    });

    it('never demotes an existing admin who logs in with a short OTP', async () => {
      users.findOne.mockResolvedValue(makeRider({ role: 'admin' }));

      const result = await service.verifyOtp({ phone: adminPhone, otp: '1234' });

      expect(result.user.role).toBe('admin');
      expect(adminUpdateCalls()).toHaveLength(0); // early return, no writes at all
    });

    it('does not promote phones outside ADMIN_PHONES even with a 6-digit OTP', async () => {
      users.findOne.mockResolvedValue(makeRider({ phone: '9000000000' }));

      const result = await service.verifyOtp({ phone: '9000000000', otp: '123456' });

      expect(adminUpdateCalls()).toHaveLength(0);
      expect(result.user.role).toBe('rider');
    });
  });

  describe('sendOtp response (SEC-1)', () => {
    it('reports otpLength so the app can render that many boxes', async () => {
      const response = await service.sendOtp({ phone: adminPhone });

      expect(response).toEqual({
        message: 'OTP sent',
        expiresInSeconds: 300,
        otpLength: 4, // from the mocked OtpService's configured width
      });
      expect(otp.assertCanSend).toHaveBeenCalledWith(adminPhone);
    });
  });
});
