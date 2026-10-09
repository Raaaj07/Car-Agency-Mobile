import { Logger, ServiceUnavailableException } from '@nestjs/common';
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
 * SEC-2: social sign-in fails closed without an audience and links an
 * account by email only when that address is proven (emailVerified).
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
  let configValues: Record<string, string | undefined>;
  let configGet: jest.Mock;

  const adminPhone = '9876543210';

  // Fresh object per test — promotion mutates role, so shared state would
  // leak an admin into the "stays rider" assertions. Overrides are applied
  // BEFORE the toFrontendUser closure captures the object, so the method
  // always reflects this instance's current state.
  const makeRider = (
    overrides: {
      role?: string;
      phone?: string;
      email?: string | null;
      emailVerified?: boolean;
      googleId?: string | null;
    } = {},
  ) => {
    const user = {
      id: 'u-1',
      phone: overrides.phone ?? adminPhone,
      name: 'Owner',
      role: overrides.role ?? 'rider',
      language: 'en',
      profileComplete: true,
      avatar: null as string | null,
      email: overrides.email ?? null,
      emailVerified: overrides.emailVerified ?? false,
      googleId: overrides.googleId ?? null,
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

  // Replaces the real google-auth-library client so the audience guard and
  // every payload branch can be driven without network or key material.
  const setGooglePayload = (payload: Record<string, unknown> | null) => {
    const client = {
      verifyIdToken: jest.fn().mockResolvedValue({ getPayload: () => payload }),
    };
    (service as unknown as { googleClient: typeof client }).googleClient = client;
    return client;
  };

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
    configValues = {
      ADMIN_PHONES: adminPhone,
      GOOGLE_WEB_CLIENT_ID: 'gid-test',
      APPLE_CLIENT_ID: 'aid-test',
    };
    configGet = jest.fn().mockImplementation((key: string) => configValues[key]);
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

  describe('social sign-in audiences (SEC-2a)', () => {
    it('fails closed with 503 when GOOGLE_WEB_CLIENT_ID is unset — never verifies blind', async () => {
      delete configValues.GOOGLE_WEB_CLIENT_ID;
      const client = setGooglePayload(null);

      const err = await service.googleSignIn('any-token').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getStatus()).toBe(503);
      expect(client.verifyIdToken).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when APPLE_CLIENT_ID is unset', async () => {
      delete configValues.APPLE_CLIENT_ID;

      const err = await service.appleSignIn('any-token', undefined).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getStatus()).toBe(503);
    });
  });

  describe('google sign-in linking (SEC-2b)', () => {
    beforeEach(() => {
      configValues.ADMIN_PHONES = ''; // promotion is covered above, not here
    });

    it('links by email only into an account that already proved the address', async () => {
      setGooglePayload({ sub: 'g-1', email: 'Victim@Example.com', email_verified: true });
      const existing = makeRider({ email: 'victim@example.com', emailVerified: true });
      users.findOne
        .mockResolvedValueOnce(null) // no googleId match yet
        .mockResolvedValueOnce(existing); // email lookup uses the lowercased form

      const result = await service.googleSignIn('tok');

      expect(users.findOne).toHaveBeenNthCalledWith(2, { where: { email: 'victim@example.com' } });
      expect(result.isNewUser).toBe(false);
      expect(existing.googleId).toBe('g-1'); // linked
      expect(existing.emailVerified).toBe(true);
    });

    it('does NOT link into an account whose email was never verified (pre-hijack)', async () => {
      setGooglePayload({ sub: 'g-1', email: 'victim@example.com', email_verified: true });
      const attackerRow = makeRider({ email: 'victim@example.com', emailVerified: false });
      users.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(attackerRow);
      users.create.mockImplementation((data: Record<string, unknown>) => {
        const created = makeRider();
        Object.assign(created, data);
        return created;
      });

      const result = await service.googleSignIn('tok');

      // A separate account is started; the pre-set row is left untouched...
      expect(result.isNewUser).toBe(true);
      expect(attackerRow.googleId).toBeNull();
      expect(attackerRow.emailVerified).toBe(false);
      // ...and the taken address is neither reused nor flagged proven.
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ googleId: 'g-1', email: null, emailVerified: false }),
      );
    });

    it('stores a new account email verified when Google verified it', async () => {
      setGooglePayload({ sub: 'g-1', email: 'New@Example.com', email_verified: true });
      users.findOne.mockResolvedValue(null); // no googleId, no email match
      users.create.mockImplementation((data: Record<string, unknown>) => {
        const created = makeRider();
        Object.assign(created, data);
        return created;
      });

      const result = await service.googleSignIn('tok');

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com', emailVerified: true }),
      );
      expect(result.isNewUser).toBe(true);
    });

    it('flags the stored address proven only when Google verified THAT address', async () => {
      setGooglePayload({ sub: 'g-1', email: 'Other@Example.com', email_verified: true });
      const account = makeRider({
        email: 'victim@example.com',
        emailVerified: false,
        googleId: 'g-1',
      });
      users.findOne.mockResolvedValueOnce(account);

      await service.googleSignIn('tok');

      expect(account.emailVerified).toBe(false); // different address — not proven
      expect(account.email).toBe('victim@example.com'); // never overwritten
    });

    it('rejects a Google login whose email Google has not verified', async () => {
      setGooglePayload({ sub: 'g-1', email: 'x@example.com', email_verified: false });
      users.findOne.mockResolvedValueOnce(null);

      await expect(service.googleSignIn('tok')).rejects.toThrow('Google email not verified');
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('updateMe email provenance (SEC-2b)', () => {
    it('invalidates emailVerified when the address changes', async () => {
      const user = makeRider({ email: 'a@example.com', emailVerified: true });
      users.findOne.mockResolvedValue(user);

      await service.updateMe('u-1', { email: 'B@Example.com' });

      expect(user.email).toBe('b@example.com');
      expect(user.emailVerified).toBe(false);
    });

    it('keeps emailVerified when the address is unchanged (case-insensitive)', async () => {
      const user = makeRider({ email: 'a@example.com', emailVerified: true });
      users.findOne.mockResolvedValue(user);

      await service.updateMe('u-1', { email: 'A@EXAMPLE.com' });

      expect(user.emailVerified).toBe(true);
    });
  });
});
