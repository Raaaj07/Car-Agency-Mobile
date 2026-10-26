import { ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import appleSignin from 'apple-signin-auth';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { GeoService } from '../drivers/geo.service';
import { ApplicationEventsService } from '../common/events/application-events.service';
import { SavedPlaceEntity } from '../places/entities/saved-place.entity';
import { StorageService } from '../drivers/storage.service';
import { AuthService } from './auth.service';
import { UserEntity } from './entities/user.entity';
import { RefreshSessionEntity } from './entities/refresh-session.entity';
import { OtpService } from './otp.service';
import { SmsProvider } from './providers/sms-provider.interface';
import { TokensService } from './tokens.service';

// Pass-4: the Apple identity-token path gets real tests (collision + disabled
// account) — the library call is driven through this mock.
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));

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
    manager: { findOne: jest.Mock; transaction: jest.Mock };
  };
  // Task 2: session repository mock.
  let sessions: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  // Pass-4 (task 12): transaction double — `users.manager.transaction(cb)`
  // hands the callback this `tx`, which records every write it performs.
  let tx: {
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let geo: { removeDriver: jest.Mock };
  let storage: { deleteDocument: jest.Mock };
  let sms: { sendOtp: jest.Mock };
  let events: { emitSessionRevoked: jest.Mock };
  let otp: {
    verify: jest.Mock;
    assertCanSend: jest.Mock;
    issue: jest.Mock;
    rollbackSend: jest.Mock;
    otpLength: number;
  };
  let issueTokens: jest.Mock;
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
      appleId?: string | null;
      isActive?: boolean;
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
      appleId: overrides.appleId ?? null,
      isActive: overrides.isActive ?? true,
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

  // Pass-4: drives the Apple payload branch through the jest.mock above.
  const setApplePayload = (payload: Record<string, unknown> | null) => {
    const verify = appleSignin.verifyIdToken as jest.Mock;
    verify.mockResolvedValue(payload);
    return verify;
  };

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    users = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation(async (u: unknown) => u),
      create: jest.fn().mockImplementation((u: unknown) => u),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: { findOne: jest.fn(), transaction: jest.fn() },
    };
    // Transaction double for deleteMe: run the callback with `tx`, which
    // records every write. findOne dispatches by entity (RideEntity only).
    tx = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockImplementation(async (row: unknown) => row),
      // TypeORM's create(entityClass, obj) returns the object as an entity.
      create: jest.fn().mockImplementation((_entity: unknown, row: unknown) => row),
    };
    users.manager.transaction.mockImplementation(
      async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );
    users.manager.findOne.mockResolvedValue(null);
    // Task 2: sessions mock — by default no session exists.
    sessions = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((row: unknown) => row),
      save: jest.fn().mockImplementation(async (row: unknown) => row),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    geo = { removeDriver: jest.fn().mockResolvedValue(undefined) };
    storage = { deleteDocument: jest.fn().mockResolvedValue(undefined) };
    sms = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    events = { emitSessionRevoked: jest.fn() };
    otp = {
      verify: jest.fn().mockResolvedValue({ ok: true }),
      assertCanSend: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn().mockResolvedValue('1234'),
      rollbackSend: jest.fn().mockResolvedValue(undefined),
      otpLength: 4,
    };
    configValues = {
      ADMIN_PHONES: adminPhone,
      GOOGLE_WEB_CLIENT_ID: 'gid-test',
      APPLE_CLIENT_ID: 'aid-test',
    };
    configGet = jest.fn().mockImplementation((key: string) => configValues[key]);
    issueTokens = jest.fn().mockReturnValue({ accessToken: 'a', refreshToken: 'r' });
    service = new AuthService(
      users as unknown as Repository<UserEntity>,
      { findOne: jest.fn().mockResolvedValue(null) } as unknown as Repository<DriverEntity>,
      sessions as unknown as Repository<RefreshSessionEntity>,
      otp as unknown as OtpService,
      { issueTokens } as unknown as TokensService,
      sms as unknown as SmsProvider,
      { get: configGet } as unknown as ConfigService,
      {} as unknown as JwtService,
      storage as unknown as StorageService,
      geo as unknown as GeoService,
      events as unknown as ApplicationEventsService,
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

  describe('sendOtp provider failure (Phase 1.5)', () => {
    it('rolls the quota back and answers 503 instead of locking the user out', async () => {
      sms.sendOtp.mockRejectedValue(new Error('msg91 500 for +91' + adminPhone));

      const err = await service.sendOtp({ phone: adminPhone }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getStatus()).toBe(503);
      expect(otp.rollbackSend).toHaveBeenCalledWith(adminPhone);
      // The warning must never carry the phone (nor the code/provider text).
      expect(warnSpy).toHaveBeenCalledWith(expect.not.stringContaining(adminPhone));
    });

    it('still surfaces the provider error path as 503 when the rollback itself fails', async () => {
      sms.sendOtp.mockRejectedValue(new Error('down'));
      otp.rollbackSend.mockRejectedValue(new Error('redis down'));

      const err = await service.sendOtp({ phone: adminPhone }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('session revocation notifies realtime (Phase 1.1)', () => {
    it('logout with a sid closes only that session', async () => {
      await service.logout('u-1', undefined, 'sess-9');

      expect(events.emitSessionRevoked).toHaveBeenCalledWith({
        userId: 'u-1',
        sessionId: 'sess-9',
        reason: 'session_revoked',
      });
    });

    it('legacy logout without a sid falls back to every socket of the user', async () => {
      await service.logout('u-1', 'refresh-token');

      expect(events.emitSessionRevoked).toHaveBeenCalledWith({
        userId: 'u-1',
        reason: 'session_revoked',
      });
    });

    it('logout-everywhere closes every socket of the user', async () => {
      await service.logoutEverywhere('u-1');

      expect(events.emitSessionRevoked).toHaveBeenCalledWith({
        userId: 'u-1',
        reason: 'session_revoked',
      });
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

  describe('disabled accounts are refused at every sign-in (pass-4)', () => {
    it('verifyOtp: 403 before any token is issued or row saved', async () => {
      users.findOne.mockResolvedValue(makeRider({ isActive: false }));

      const err = await service.verifyOtp({ phone: adminPhone, otp: '1234' }).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getStatus()).toBe(403);
      expect(issueTokens).not.toHaveBeenCalled();
      expect(users.save).not.toHaveBeenCalled(); // no state change either
    });

    it('googleSignIn: 403 before any token is issued', async () => {
      setGooglePayload({ sub: 'g-1', email: 'x@example.com', email_verified: true });
      users.findOne.mockResolvedValueOnce(makeRider({ googleId: 'g-1', isActive: false }));

      const err = await service.googleSignIn('tok').catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getStatus()).toBe(403);
      expect(issueTokens).not.toHaveBeenCalled();
    });

    it('appleSignIn: 403 before any token is issued', async () => {
      setApplePayload({ sub: 'ap-1', email: null });
      users.findOne.mockResolvedValueOnce(makeRider({ appleId: 'ap-1', isActive: false }));

      const err = await service.appleSignIn('tok', undefined).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getStatus()).toBe(403);
      expect(issueTokens).not.toHaveBeenCalled();
    });
  });

  describe('apple sign-in email collisions (pass-4)', () => {
    beforeEach(() => {
      configValues.ADMIN_PHONES = ''; // promotion is covered above, not here
      users.create.mockImplementation((data: Record<string, unknown>) => {
        const created = makeRider();
        Object.assign(created, data);
        return created;
      });
    });

    it('never links by Apple email: an address another row owns is stored as null', async () => {
      setApplePayload({ sub: 'ap-1', email: 'Victim@Example.com' });
      users.findOne
        .mockResolvedValueOnce(null) // no appleId match
        .mockResolvedValueOnce(makeRider({ email: 'victim@example.com' })); // address owned

      const result = await service.appleSignIn('tok', 'Vic Tor');

      expect(users.findOne).toHaveBeenNthCalledWith(2, { where: { email: 'victim@example.com' } });
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ appleId: 'ap-1', email: null, name: 'Vic Tor' }),
      );
      expect(result.isNewUser).toBe(true);
    });

    it('stores the Apple email when free, and never flags it verified', async () => {
      setApplePayload({ sub: 'ap-2', email: 'New@Example.com' });
      users.findOne.mockResolvedValue(null);

      const result = await service.appleSignIn('tok', undefined);

      const created = users.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created).toEqual(
        expect.objectContaining({ appleId: 'ap-2', email: 'new@example.com' }),
      );
      // Apple's claim is not independently verified here — the flag must
      // never be set true by the sign-in itself.
      expect(created.emailVerified ?? false).toBe(false);
      expect(result.isNewUser).toBe(true);
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

  /**
   * Pass-4 (task 12): compliance account deletion. One transaction, no data
   * resurrection through the old phone, and driver document files purged.
   */
  describe('deleteMe (pass-4 task-12)', () => {
    const makeDriver = (overrides: Record<string, unknown> = {}) => ({
      id: 'drv-1',
      userId: 'u-1',
      vehicleType: 'sedan',
      status: 'approved',
      isOnline: true,
      isAvailable: true,
      upiVpa: 'ok@upi',
      licenseImagePath: 'uploads/lic.png',
      rcImagePath: 'uploads/rc.png',
      vehiclePhotoPath: 'uploads/car.png',
      ...overrides,
    });

    // users.manager.findOne dispatches by entity: UserEntity -> the user row,
    // DriverEntity -> the driver row, RideEntity -> the active-ride probe.
    const setManagerReads = (opts: {
      user?: unknown;
      driver?: unknown;
      activeRide?: unknown;
    }) => {
      users.manager.findOne.mockImplementation(
        async (entity: { name?: string }, _where?: unknown) => {
          if (entity.name?.includes('User')) return opts.user ?? null;
          if (entity.name?.includes('Driver')) return opts.driver ?? null;
          return opts.activeRide ?? null; // RideEntity probe (also the tx one via tx.findOne)
        },
      );
      tx.findOne.mockResolvedValue(opts.activeRide ?? null);
    };

    it('refuses with 409 while the user has an active ride as rider', async () => {
      setManagerReads({ user: makeRider(), activeRide: { id: 'ride-1' } });

      await expect(service.deleteMe('u-1')).rejects.toMatchObject({ status: 409 });
      // The in-transaction re-check threw — nothing was ever written.
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.save).not.toHaveBeenCalled();
    });

    it('refuses with 409 while the user has an active ride as driver', async () => {
      setManagerReads({
        user: makeRider(),
        driver: makeDriver(),
        activeRide: { id: 'ride-2' },
      });

      await expect(service.deleteMe('u-1')).rejects.toMatchObject({ status: 409 });
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.save).not.toHaveBeenCalled();
    });

    it('anonymises the user row, deletes saved places and audits — in one transaction', async () => {
      setManagerReads({
        user: makeRider({ email: 'keep@example.com' }),
        driver: null,
        activeRide: null,
      });

      const result = await service.deleteMe('u-1');

      expect(result).toEqual({ ok: true });
      // tx.update(entity, where, patch) — patch is the THIRD argument.
      const [, userWhere, userPatch] = tx.update.mock.calls.find(
        (c: unknown[]) => (c[0] as { name?: string })?.name?.includes('User'),
      )!;
      expect(userWhere).toEqual({ id: 'u-1' });
      expect(userPatch).toMatchObject({
        isActive: false,
        refreshTokenHash: null,
        name: 'Deleted user',
        email: null,
        emailVerified: false,
        googleId: null,
        appleId: null,
        avatar: null,
      });
      // Phone is a non-reusable tombstone (see next test) — never the old number.
      expect(userPatch.phone).toMatch(/^deleted:/);

      expect(tx.delete).toHaveBeenCalledWith(SavedPlaceEntity, { userId: 'u-1' });

      const audit = tx.save.mock.calls[0][0];
      expect(audit).toMatchObject({
        action: 'account_delete',
        targetType: 'user',
        targetId: 'u-1',
        actorUserId: 'u-1',
      });
      // No PII in the audit row beyond ids.
      expect(JSON.stringify(audit)).not.toMatch(/example\.com/);
    });

    it('frees the phone number for re-signup (tombstone, column-safe length)', async () => {
      setManagerReads({ user: makeRider(), driver: null, activeRide: null });

      await service.deleteMe('u-1');

      const patch = tx.update.mock.calls.find(
        (c: unknown[]) => (c[0] as { name?: string })?.name?.includes('User'),
      )![2] as { phone: string };
      expect(patch.phone).not.toBe(adminPhone); // the real number is reusable
      expect(patch.phone.length).toBeLessThanOrEqual(20); // fits varchar(20)
      expect(patch.phone).toMatch(/^deleted:[0-9a-f]+$/); // unique per deletion
    });

    it('suspends the driver, forces offline, clears doc columns + VPA, purges files', async () => {
      setManagerReads({ user: makeRider(), driver: makeDriver(), activeRide: null });

      await service.deleteMe('u-1');

      const patch = tx.update.mock.calls.find(
        (c: unknown[]) => (c[0] as { name?: string })?.name?.includes('Driver'),
      )![2] as Record<string, unknown>;
      expect(patch).toMatchObject({
        status: 'suspended',
        isOnline: false,
        isAvailable: false,
        upiVpa: null,
        licenseImagePath: null,
        rcImagePath: null,
        vehiclePhotoPath: null,
      });

      // Forced offline in the Redis geo-sets; files purged AFTER the commit.
      expect(geo.removeDriver).toHaveBeenCalledWith('drv-1', 'sedan');
      expect(storage.deleteDocument).toHaveBeenCalledWith('uploads/lic.png');
      expect(storage.deleteDocument).toHaveBeenCalledWith('uploads/rc.png');
      expect(storage.deleteDocument).toHaveBeenCalledWith('uploads/car.png');
      expect(storage.deleteDocument).toHaveBeenCalledTimes(3);
    });

    it('never blocks deletion on geo/storage failures (best-effort after commit)', async () => {
      setManagerReads({ user: makeRider(), driver: makeDriver(), activeRide: null });
      geo.removeDriver.mockRejectedValue(new Error('redis down'));
      storage.deleteDocument.mockRejectedValue(new Error('disk gone'));

      await expect(service.deleteMe('u-1')).resolves.toEqual({ ok: true });
    });
  });

  /**
   * Refresh sessions: one row per device, rotation with a 30 s lost-reply
   * grace window, replay ends ONLY the session the stale token names.
   */
  describe('refresh sessions', () => {
    const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
    const future = () => new Date(Date.now() + 86_400_000);
    let verifyAsync: jest.Mock;

    beforeEach(() => {
      verifyAsync = jest.fn().mockResolvedValue({ sub: 'u-1', sid: 's-1' });
      (service as unknown as { jwt: { verifyAsync: jest.Mock } }).jwt = { verifyAsync };
      users.findOne.mockResolvedValue({ ...makeRider(), refreshTokenHash: null });
    });

    it('rotates the current token: new pair is bound to the same session, old hash kept as previous', async () => {
      sessions.findOne.mockResolvedValueOnce({
        id: 's-1', userId: 'u-1', tokenHash: sha('old'), expiresAt: future(), revokedAt: null,
      });

      const pair = await service.refresh('old');

      expect(pair.accessToken).toBe('a');
      expect(issueTokens).toHaveBeenCalledWith(expect.anything(), 's-1');
      const [where, patch] = sessions.update.mock.calls[0];
      expect(where).toMatchObject({ id: 's-1', tokenHash: sha('old') });
      expect(patch).toMatchObject({ tokenHash: sha('r'), previousTokenHash: sha('old') });
    });

    it('lost-reply retry inside the grace window rotates from the stored token (never returns an unsaved one)', async () => {
      sessions.findOne
        .mockResolvedValueOnce(null) // not the current token
        .mockResolvedValueOnce({
          id: 's-1', userId: 'u-1', tokenHash: sha('cur'), previousTokenHash: sha('old'),
          previousTokenAt: new Date(Date.now() - 5_000), expiresAt: future(), revokedAt: null,
        });

      const pair = await service.refresh('old');

      expect(pair.refreshToken).toBe('r');
      const [where, patch] = sessions.update.mock.calls[0];
      expect(where).toMatchObject({ id: 's-1', tokenHash: sha('cur') });
      // The refresh token we hand back IS the one now stored.
      expect(patch).toMatchObject({ tokenHash: sha('r'), previousTokenHash: sha('cur') });
    });

    it('a stale token outside the grace window ends ONLY its own session', async () => {
      sessions.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 's-1', userId: 'u-1', tokenHash: sha('cur'), previousTokenHash: sha('old'),
          previousTokenAt: new Date(Date.now() - 120_000), expiresAt: future(), revokedAt: null,
        });

      await expect(service.refresh('old')).rejects.toMatchObject({ status: 401 });

      expect(sessions.update).toHaveBeenCalledTimes(1);
      expect(sessions.update.mock.calls[0][0]).toEqual({ id: 's-1', userId: 'u-1' });
      expect(sessions.update.mock.calls[0][1]).toMatchObject({ revokedAt: expect.any(Date) });
    });

    it('a revoked session refuses to refresh', async () => {
      sessions.findOne.mockResolvedValueOnce({
        id: 's-1', userId: 'u-1', tokenHash: sha('old'), expiresAt: future(), revokedAt: new Date(),
      });

      await expect(service.refresh('old')).rejects.toMatchObject({ status: 401 });
      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('adopts a pre-session login once (legacy hash on the user row) instead of signing it out', async () => {
      verifyAsync.mockResolvedValue({ sub: 'u-1' }); // old tokens carry no sid
      users.findOne.mockResolvedValue({ ...makeRider(), refreshTokenHash: sha('legacy') });
      sessions.findOne.mockResolvedValue(null);

      const pair = await service.refresh('legacy');

      expect(pair.accessToken).toBe('a');
      expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: sha('legacy') }));
      expect(users.update).toHaveBeenCalledWith({ id: 'u-1' }, { refreshTokenHash: null });
    });

    it('logout with a session id ends only that device', async () => {
      await service.logout('u-1', undefined, 's-9');

      expect(sessions.update).toHaveBeenCalledTimes(1);
      expect(sessions.update.mock.calls[0][0]).toEqual({ id: 's-9', userId: 'u-1' });
    });

    it('logout of a pre-session token (no way to tell the device) ends them all', async () => {
      await service.logout('u-1');

      expect(sessions.update.mock.calls[0][0]).toEqual({ userId: 'u-1' });
    });
  });
});
