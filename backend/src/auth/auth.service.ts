import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { User as FrontendUser } from '../common/frontend-contracts';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { GeoService } from '../drivers/geo.service';
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';
import { SavedPlaceEntity } from '../places/entities/saved-place.entity';
import { ACTIVE_RIDE_STATUSES, RideEntity } from '../rides/entities/ride.entity';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { UserEntity } from './entities/user.entity';
import { RefreshSessionEntity } from './entities/refresh-session.entity';
import { OtpService } from './otp.service';
import { SMS_PROVIDER, SmsProvider } from './providers/sms-provider.interface';
import { TokenPair, TokensService } from './tokens.service';
import { StorageService } from '../drivers/storage.service';
import { toAvatarUrl } from '../common/avatar-url';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { UpdateMeDto } from './dto/update-me.dto';

export interface VerifyOtpResult extends TokenPair {
  user: FrontendUser;
  isNewUser: boolean;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

type DriverStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';

// SEC-1: a short OTP is practically brute-forceable, so admin promotion at
// OTP login is refused below this width (log a warning instead). The owner
// must run OTP_LENGTH>=6 in production before any new admin gets in.
const ADMIN_OTP_MIN_LENGTH = 6;

/**
 * Task 2: Grace window for re-presenting the previous token after a rotation.
 * A client whose refresh response was lost in transit may retry with the same
 * token within 30 seconds and receive a fresh pair without being locked out.
 */
const ROTATION_GRACE_WINDOW_MS = 30_000;

function mapStatusToDriverStatus(v: string | null | undefined): DriverStatus {
  if (v === 'approved' || v === 'pending' || v === 'rejected' || v === 'suspended') return v;
  return 'none';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient = new OAuth2Client();

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
    @InjectRepository(RefreshSessionEntity) private readonly sessions: Repository<RefreshSessionEntity>,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
    // Pass-4 (task 12): account deletion must also drop a driver from the
    // Redis geo-sets (force offline), so a deleted driver stops matching.
    private readonly geo: GeoService,
  ) {}

  // Matches MobileNumberScreen -> POST /auth/otp/send
  async sendOtp({ phone }: SendOtpDto): Promise<{
    message: string;
    expiresInSeconds: number;
    otpLength: number;
    devOtp?: string;
  }> {
    // AU-1: per-phone cooldown + window cap, before any SMS is spent.
    // SEC-1: assertCanSend also refuses while the phone is locked out.
    await this.otp.assertCanSend(phone);
    const code = await this.otp.issue(phone);
    await this.sms.sendOtp(phone, code);
    const ttl = Number(this.config.get<string>('OTP_TTL_SECONDS') ?? 300);
    const response = {
      message: 'OTP sent',
      expiresInSeconds: Number.isFinite(ttl) ? ttl : 300,
      // SEC-1: the OTP screen renders this many boxes. Absent in old payloads,
      // so old servers keep old apps at the 4-box default.
      otpLength: this.otp.otpLength,
    };

    // Fail-closed default: missing env means no leak. Prod refusal enforced in Phase 6.
    const isProd = (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';
    const devModeFlag = (this.config.get<string>('OTP_DEV_MODE') ?? 'false') === 'true';
    if (devModeFlag && !isProd) {
      return { ...response, devOtp: code };
    }
    return response;
  }

  // Single login for everyone: new users are riders with profileComplete=false.
  // Pass-4 (task 4): `ip` feeds the per-IP failed-verify cap in OtpService.
  async verifyOtp({ phone, otp, name }: VerifyOtpDto, ip?: string, deviceLabel?: string): Promise<VerifyOtpResult> {
    const result = await this.otp.verify(phone, otp, ip);
    if (!result.ok) {
      throw new BadRequestException(result.reason ?? 'Invalid OTP');
    }

    let user = await this.users.findOne({ where: { phone } });
    const isNewUser = !user;

    if (!user) {
      user = this.users.create({
        phone,
        name: name?.trim() || 'New Rider',
        role: 'rider',
        language: 'en',
        profileComplete: false,
      });
    } else if (!user.role) {
      user.role = 'rider';
    }
    // Pass-4 (task 3): a disabled account is refused BEFORE any token is
    // issued — previously the tokens were minted here and only the NEXT
    // request was rejected by JwtStrategy.
    if (user.isActive === false) throw new ForbiddenException('This account has been disabled');
    user = await this.users.save(user);
    // First admin(s) can also be promoted at OTP login (covers phones that
    // signed up after the last server start; ADMIN_PHONES is 10-digit).
    // SEC-1: pass the code width — a match requires equal lengths, so the
    // submitted otp.length IS the issued code's length here.
    await this.promoteAdminByPhone(user, otp.length);

    const tokenPair = await this.issueAndPersistSession(user, deviceLabel);
    const full = await this.toFullUser(user);
    return { ...tokenPair, user: full, isNewUser };
  }

  // Shared with AdminService.onApplicationBootstrap (start-up promotion).
  // Compares trailing-10-digit phone forms so "+91..." entries still match.
  // otpLength is supplied only by the OTP login path; social sign-in passes
  // nothing because its tokens are provider-verified (no code to brute-force).
  private async promoteAdminByPhone(user: UserEntity, otpLength?: number): Promise<void> {
    if ((user.role as string) === 'admin') return;
    const raw = this.config.get<string>('ADMIN_PHONES') ?? '';
    const want = new Set(
      raw.split(',').map((s) => s.replace(/\D/g, '').slice(-10)).filter((s) => s.length === 10),
    );
    const mine = (user.phone ?? '').replace(/\D/g, '').slice(-10);
    if (want.size > 0 && mine.length === 10 && want.has(mine)) {
      // SEC-1: never mint an admin session through a login whose OTP is too
      // short to resist brute force. Warn (no phone digits logged) and stay
      // rider; an existing admin is never demoted (early return above).
      if (otpLength !== undefined && otpLength < ADMIN_OTP_MIN_LENGTH) {
        this.logger.warn(
          `Admin promotion refused: OTP length ${otpLength} < ${ADMIN_OTP_MIN_LENGTH} (user ${user.id})`,
        );
        return;
      }
      await this.users.update({ id: user.id }, { role: 'admin' as any }).catch(() => {});
      user.role = 'admin' as any;
    }
  }

  async googleSignIn(idToken: string, deviceLabel?: string): Promise<VerifyOtpResult> {
    const audience = this.config.get<string>('GOOGLE_WEB_CLIENT_ID');
    // SEC-2a: with no audience the library SKIPS the aud check entirely
    // (google-auth-library only verifies aud "if we have one"), so any
    // Google-signed token minted for another app would be accepted here —
    // a classic account takeover (replay a victim's token from elsewhere).
    // Fail closed with 503 instead of verifying blind; production boot also
    // requires the variable (env.validation.ts).
    if (!audience) throw new ServiceUnavailableException('Google sign-in is not configured');

    // SEC: a malformed/expired token is attacker-controlled input — map the
    // provider library's raw rejection to 400 instead of letting it escape
    // as an unhandled 500.
    const payload = await this.googleClient
      .verifyIdToken({ idToken, audience })
      .then((ticket) => ticket.getPayload(), () => undefined);
    if (!payload?.sub) throw new BadRequestException('Invalid Google token');

    // SEC-2b: Google returns mixed-case addresses; every lookup and the
    // unique index on users.email must see one canonical form, or the same
    // address can mismatch (missed link) or collide (23505 -> 500).
    const email = payload.email ? payload.email.toLowerCase() : null;
    const emailVerifiedByGoogle = email !== null && payload.email_verified === true;

    let user = await this.users.findOne({ where: { googleId: payload.sub } });
    let emailTakenByUnverifiedRow = false;
    if (!user && email) {
      // Prevent account takeover: only consider linking when Google confirms the email.
      if (!emailVerifiedByGoogle) {
        throw new BadRequestException('Google email not verified');
      }
      const byEmail = await this.users.findOne({ where: { email } });
      // SEC-2b: link ONLY into an account that already proved this address.
      // PATCH /auth/me lets anyone store an UNVERIFIED email, so linking on
      // it would let an attacker pre-set the victim's address on their own
      // account and capture the victim's next "Sign in with Google". A
      // separate account is started instead of rejecting: rejection would
      // let that pre-set address DoS the victim's Google sign-up, and
      // reusing the address would hit the unique index.
      if (byEmail?.emailVerified) {
        user = byEmail;
      } else if (byEmail) {
        emailTakenByUnverifiedRow = true;
      }
    }
    const isNewUser = !user;
    if (!user) {
      user = this.users.create({
        googleId: payload.sub,
        // The address is only stored (and flagged verified) when Google
        // vouched for it AND no unverified row already owns it.
        email: emailTakenByUnverifiedRow ? null : email,
        emailVerified: emailVerifiedByGoogle && !emailTakenByUnverifiedRow,
        name: payload.name || 'New Rider',
        avatar: payload.picture ?? null,
        role: 'rider',
        language: 'en',
        profileComplete: false,
      });
    } else {
      if (!user.googleId) user.googleId = payload.sub;
      if (!user.role) user.role = 'rider';
      if (payload.picture && !user.avatar) user.avatar = payload.picture;
      // SEC-2b: trust Google's verification only for the exact address it
      // verified — never flag a different stored address as proven.
      if (emailVerifiedByGoogle && user.email?.toLowerCase() === email) {
        user.emailVerified = true;
      }
    }
    // Pass-4 (task 3): disabled account → 403 before any token is issued.
    if (user.isActive === false) throw new ForbiddenException('This account has been disabled');
    user = await this.users.save(user);
    // A-1: ADMIN_PHONES promotion must also run at social sign-in, not just
    // OTP login — otherwise an owner who signs up after boot never gets in.
    await this.promoteAdminByPhone(user);

    const tokenPair = await this.issueAndPersistSession(user, deviceLabel);
    const full = await this.toFullUser(user);
    return { ...tokenPair, user: full, isNewUser };
  }

  async appleSignIn(
    identityToken: string,
    fullName: string | undefined,
    deviceLabel?: string,
  ): Promise<VerifyOtpResult> {
    const audience = this.config.get<string>('APPLE_CLIENT_ID');
    // SEC-2a: apple-signin-auth spreads { audience } straight into
    // jsonwebtoken's verify options — undefined means NO aud check, so a
    // token minted for another Apple app would be accepted. Fail closed
    // with 503 (production boot requires the variable too).
    if (!audience) throw new ServiceUnavailableException('Apple sign-in is not configured');
    // SEC: same as googleSignIn — a garbage identity token must yield 400,
    // never an unhandled 500 from inside the Apple verification library.
    const payload = await appleSignin
      .verifyIdToken(identityToken, { audience })
      .catch(() => undefined);
    if (!payload?.sub) throw new BadRequestException('Invalid Apple token');

    let user = await this.users.findOne({ where: { appleId: payload.sub } });
    let isNewUser = !user;
    if (!user) {
      // Pass-4 (task 3): mirror the Google rule — never LINK by Apple email.
      // The claim is unverified here, Apple may send a private relay address,
      // and a raw save on an address another row already owns throws 23505 →
      // an unhandled 500. When any row owns the address, store null instead
      // (the account still starts; Apple sign-in resumes via appleId).
      let email = (payload as { email?: string }).email?.toLowerCase() ?? null;
      if (email && (await this.users.findOne({ where: { email } }))) {
        email = null;
      }
      user = this.users.create({
        appleId: payload.sub,
        // Canonical lowercase form — same reason as googleSignIn.
        email,
        // Apple only sends fullName on the FIRST sign-in ever — capture it now or lose it.
        name: fullName?.trim() || 'New Rider',
        role: 'rider',
        language: 'en',
        profileComplete: false,
      });
      isNewUser = true;
    }
    // Pass-4 (task 3): disabled account → 403 before any token is issued.
    // (New rows never hit this — they are created active.)
    if (user.isActive === false) throw new ForbiddenException('This account has been disabled');
    if (!user.role) user.role = 'rider';
    user = await this.users.save(user);
    // A-1: same promotion pass as OTP/Google sign-in.
    await this.promoteAdminByPhone(user);

    const tokenPair = await this.issueAndPersistSession(user, deviceLabel);
    const full = await this.toFullUser(user);
    return { ...tokenPair, user: full, isNewUser };
  }

  async findById(userId: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id: userId } });
  }

  async me(userId: string): Promise<FrontendUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return this.toFullUser(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<FrontendUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) throw new BadRequestException('Name cannot be empty');
      user.name = trimmed;
      // Name is the only required profile field: a real name completes onboarding.
      if (trimmed.length >= 2 && !/^new\s/i.test(trimmed)) {
        user.profileComplete = true;
      }
    }
    if (dto.email !== undefined) {
      const next = dto.email?.toLowerCase().trim() || null;
      // SEC-2b: a self-asserted address proves nothing (no verification
      // flow), so any change invalidates emailVerified — Google sign-in may
      // only link into accounts whose stored address was already proven.
      if (next !== user.email) {
        user.email = next;
        user.emailVerified = false;
      }
    }

    try {
      const saved = await this.users.save(user);
      return this.toFullUser(saved);
    } catch (err: any) {
      if (err?.code === '23505') throw new BadRequestException('Email already in use');
      throw err;
    }
  }

  /**
   * Task 2: Rotating refresh with multi-device session support and grace window.
   *
   * On each refresh:
   * 1. Verify the JWT signature and decode userId.
   * 2. Find a live session whose tokenHash OR previousTokenHash matches.
   * 3. If matched by previousTokenHash and within the grace window → accept,
   *    issue new tokens but keep the same tokenHash (idempotent retry).
   * 4. If matched by tokenHash → rotate: move current hash to previousTokenHash,
   *    write new tokenHash.
   * 5. If an EXPIRED previousTokenHash is presented (outside grace window),
   *    the session row won't be found by hash and we check familyId to detect
   *    the replay: revoke the whole family.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let sub: string;
    let sid: string | undefined;
    try {
      const decoded = (await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      })) as { sub: string; sid?: string };
      sub = decoded.sub;
      sid = decoded.sid;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.users.findOne({ where: { id: sub } });
    if (!user || user.isActive === false) throw new UnauthorizedException('User no longer active');

    const incomingHash = hashToken(refreshToken);
    const now = new Date();

    // 1. Happy path: the token is the session's CURRENT one.
    const current = await this.sessions.findOne({ where: { userId: sub, tokenHash: incomingHash } });
    if (current) {
      if (current.revokedAt || current.expiresAt <= now) {
        throw new UnauthorizedException('Refresh token revoked');
      }
      return this.rotateSession(current, user, incomingHash, now);
    }

    // 2. Lost-reply retry: the token is the PREVIOUS one, presented within the
    //    grace window. Rotate again from the session's current token so the
    //    pair we hand back is one the server actually stored (the old code
    //    returned a pair whose refresh token was never saved, so the very next
    //    refresh was treated as a replay and wiped the user's sessions).
    const previous = await this.sessions.findOne({ where: { userId: sub, previousTokenHash: incomingHash } });
    if (
      previous &&
      !previous.revokedAt &&
      previous.expiresAt > now &&
      previous.previousTokenAt &&
      now.getTime() - previous.previousTokenAt.getTime() <= ROTATION_GRACE_WINDOW_MS
    ) {
      return this.rotateSession(previous, user, previous.tokenHash, now);
    }

    // 3. A login made before sessions existed: its hash lives only on the user
    //    row. Adopt it as a session (once - the legacy hash is cleared) so the
    //    deploy does not sign everyone out.
    if (user.refreshTokenHash && user.refreshTokenHash === incomingHash) {
      const sessionId = randomUUID();
      const legacy = await this.sessions.save(
        this.sessions.create({
          id: sessionId,
          userId: user.id,
          familyId: sessionId,
          tokenHash: incomingHash,
          previousTokenHash: null,
          previousTokenAt: null,
          deviceLabel: 'legacy session',
          expiresAt: this.parseExpiryToDate(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d', now),
          lastUsedAt: now,
        }),
      );
      await this.users.update({ id: user.id }, { refreshTokenHash: null });
      return this.rotateSession(legacy, user, incomingHash, now);
    }

    // 4. Unknown token with a valid signature: it was rotated out long ago (or
    //    stolen and replayed). End ONLY the session it names - other devices
    //    keep working. Tokens that name no session (pre-session era) end nothing.
    if (sid) {
      await this.sessions.update({ id: sid, userId: sub }, { revokedAt: now });
      this.logger.warn(`Refresh token replay detected - session ${sid} revoked (user ${sub})`);
    }
    throw new UnauthorizedException('Refresh token revoked');
  }

  /**
   * Task 2: logout revokes ONLY the current session (identified by token hash).
   * Other devices remain authenticated.
   */
  async logout(userId: string, refreshToken?: string, sessionId?: string): Promise<{ ok: true }> {
    const now = new Date();
    if (sessionId) {
      // New tokens name their session: end exactly this device.
      await this.sessions.update({ id: sessionId, userId }, { revokedAt: now });
    } else if (refreshToken) {
      const hash = hashToken(refreshToken);
      const byCurrent = await this.sessions.update({ userId, tokenHash: hash }, { revokedAt: now });
      if (!byCurrent.affected) {
        await this.sessions.update({ userId, previousTokenHash: hash }, { revokedAt: now });
      }
    } else {
      // A pre-session token that cannot say which device it is: end them all.
      await this.sessions.update({ userId }, { revokedAt: now });
      await this.users.update({ id: userId }, { refreshTokenHash: null });
    }
    return { ok: true };
  }

  /**
   * Task 2: revoke ALL sessions for the user ("log out everywhere").
   */
  async logoutEverywhere(userId: string): Promise<{ ok: true }> {
    await this.sessions.update({ userId }, { revokedAt: new Date() });
    await this.users.update({ id: userId }, { refreshTokenHash: null });
    return { ok: true };
  }

  /**
   * Pass-4 (task 12): compliance account deletion (Google Play data-safety /
   * Apple App Store Review Guideline 5.1.1(v)).
   *
   * - refuses (409) while the user holds an active ride as rider OR driver;
   * - anonymises the user row in ONE transaction (name / email / social ids /
   *   avatar / refresh-hash cleared, phone replaced by a non-reusable
   *   tombstone so the real number can sign up again), deletes saved places,
   *   and writes an `account_delete` audit row;
   * - rides/payments rows are KEPT — financial records must survive — but now
   *   point at the anonymised user;
   * - a driver row is additionally suspended + forced offline, its document
   *   columns and UPI VPA cleared, and the stored files purged AFTER the
   *   commit (storage side effects never hold the transaction open).
   * - Task 2: also revokes all refresh sessions.
   */
  async deleteMe(userId: string): Promise<{ ok: true }> {
    const manager = this.users.manager;
    const user = await manager.findOne(UserEntity, { where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const driver = await manager.findOne(DriverEntity, { where: { userId } });

    // Tombstone: `deleted:<uuid>` truncated to the column length. Unique so
    // the index can't collide, and the real number is free again instantly.
    const tombstonePhone = `deleted:${randomUUID().replace(/-/g, '')}`.slice(0, 20);

    await manager.transaction(async (tx) => {
      // Re-check inside the transaction: a ride booked between the first read
      // and this write must still block the deletion (rollback via throw).
      const rideWhere: FindOptionsWhere<RideEntity>[] = [
        { riderId: userId, status: In(ACTIVE_RIDE_STATUSES) },
      ];
      if (driver) rideWhere.push({ driverId: driver.id, status: In(ACTIVE_RIDE_STATUSES) });
      const active = await tx.findOne(RideEntity, { where: rideWhere });
      if (active) {
        throw new ConflictException('Finish or cancel your active ride before deleting your account');
      }

      await tx.update(
        UserEntity,
        { id: userId },
        {
          isActive: false,
          refreshTokenHash: null,
          name: 'Deleted user',
          email: null,
          emailVerified: false,
          googleId: null,
          appleId: null,
          avatar: null,
          phone: tombstonePhone,
        },
      );
      await tx.delete(SavedPlaceEntity, { userId });

      if (driver) {
        await tx.update(
          DriverEntity,
          { id: driver.id },
          {
            status: 'suspended',
            isOnline: false,
            isAvailable: false,
            upiVpa: null,
            profilePhotoUrl: null,
            carImageUrl: null,
            drivingLicenceImageUrl: null,
            rcImageUrl: null,
            drivingLicenceNumber: null,
            rcNumber: null,
            licenseImagePath: null,
            rcImagePath: null,
            vehiclePhotoPath: null,
          },
        );
      }

      await tx.save(
        tx.create(AdminAuditLogEntity, {
          actorUserId: userId,
          actorName: user.name,
          action: 'account_delete',
          targetType: 'user',
          targetId: userId,
          meta: { driverId: driver?.id ?? null },
        }),
      );
    });

    // Task 2: revoke all sessions after the transaction commits.
    await this.sessions.update({ userId }, { revokedAt: new Date() }).catch(() => undefined);

    if (driver) {
      await this.geo.removeDriver(driver.id, driver.vehicleType).catch(() => undefined);
      for (const docPath of [driver.licenseImagePath, driver.rcImagePath, driver.vehiclePhotoPath]) {
        await this.storage.deleteDocument(docPath).catch(() => undefined);
      }
    }
    return { ok: true };
  }

  /**
   * Task 2: create a brand-new session (first login or re-login on a device).
   * If an existing session is supplied, update it in place (grace-window retry).
   */
  private async issueAndPersistSession(user: UserEntity, deviceLabel?: string): Promise<TokenPair> {
    const sessionId = randomUUID();
    const pair = this.tokens.issueTokens(user, sessionId);
    const now = new Date();
    const refreshExpiry = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d';
    await this.sessions.save(
      this.sessions.create({
        id: sessionId,
        userId: user.id,
        familyId: sessionId,
        tokenHash: hashToken(pair.refreshToken),
        previousTokenHash: null,
        previousTokenAt: null,
        deviceLabel: deviceLabel ? deviceLabel.slice(0, 128) : null,
        expiresAt: this.parseExpiryToDate(refreshExpiry, now),
        lastUsedAt: now,
      }),
    );
    // Housekeeping: dead sessions (revoked or expired) older than a day are
    // dropped so the table cannot grow without bound. Best-effort.
    try {
      void this.sessions
        .createQueryBuilder()
        .delete()
        .where('"userId" = :uid AND ("revokedAt" < :cut OR "expiresAt" < :cut)', {
          uid: user.id,
          cut: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        })
        .execute()
        .catch(() => undefined);
    } catch {
      // best-effort cleanup only
    }
    return pair;
  }

  /**
   * Task 2: rotate an existing session — promote current hash to previous,
   * write new hash, return new token pair.
   */
  private async rotateSession(
    session: RefreshSessionEntity,
    user: UserEntity,
    oldHash: string,
    now: Date,
  ): Promise<TokenPair> {
    const pair = this.tokens.issueTokens(user, session.id);
    const newHash = hashToken(pair.refreshToken);
    const refreshExpiry = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d';
    const expiresAt = this.parseExpiryToDate(refreshExpiry, now);

    // Conditional on the hash we just validated: two refreshes racing on the
    // same token cannot both win. The loser re-reads and, if it is inside the
    // grace window, rotates from the winner's token instead of failing.
    const res = await this.sessions.update(
      { id: session.id, tokenHash: oldHash, revokedAt: IsNull() },
      {
        tokenHash: newHash,
        previousTokenHash: oldHash,
        previousTokenAt: now,
        lastUsedAt: now,
        expiresAt,
      },
    );
    if (!res.affected) {
      const fresh = await this.sessions.findOne({ where: { id: session.id } });
      if (
        fresh &&
        !fresh.revokedAt &&
        fresh.previousTokenHash === oldHash &&
        fresh.previousTokenAt &&
        now.getTime() - fresh.previousTokenAt.getTime() <= ROTATION_GRACE_WINDOW_MS
      ) {
        return this.rotateSession(fresh, user, fresh.tokenHash, now);
      }
      throw new UnauthorizedException('Refresh token revoked');
    }
    return pair;
  }

  private parseExpiryToDate(expiry: string, from: Date): Date {
    const match = /^(\d+)([smhd])$/.exec(expiry.trim());
    if (!match) return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000); // default 30d
    const val = parseInt(match[1], 10);
    const unit = match[2];
    const ms =
      unit === 's' ? val * 1000
      : unit === 'm' ? val * 60_000
      : unit === 'h' ? val * 3_600_000
      : val * 86_400_000; // 'd'
    return new Date(from.getTime() + ms);
  }

  private async toFullUser(user: UserEntity): Promise<FrontendUser> {
    const base = user.toFrontendUser();
    const driver = await this.drivers.findOne({ where: { userId: user.id } }).catch(() => null);
    // `status` is the only source of truth; `verificationStatus` is deprecated.
    const driverStatus: DriverStatus = driver ? mapStatusToDriverStatus((driver as any).status) : 'none';
    return { ...base, avatar: this.avatarUrl(user), driverStatus };
  }

  // Local uploads store only the file name in users.avatar; expose the
  // API-relative endpoint (see toAvatarUrl). Cloudinary / social avatars are
  // https URLs and pass through untouched.
  private avatarUrl(user: UserEntity): string | undefined {
    return toAvatarUrl(user.id, user.avatar) ?? undefined;
  }

  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<FrontendUser> {
    const stored = await this.storage.storeAvatar(userId, file); // https URL (Cloudinary) or file name (local)
    await this.users.update({ id: userId }, { avatar: stored });
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    return this.toFullUser(user);
  }

  async readAvatar(userId: string): Promise<{ buffer: Buffer; mime: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    const v = user?.avatar;
    if (!v || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) {
      throw new BadRequestException('Avatar not found');
    }
    return this.storage.readAvatar(userId, v);
  }
}
