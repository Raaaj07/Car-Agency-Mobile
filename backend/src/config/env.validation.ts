import { plainToInstance } from 'class-transformer';
import { IsBooleanString, IsIn, IsNumberString, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsNumberString()
  PORT?: string;

  @IsOptional()
  @IsString()
  API_PREFIX?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  /**
   * SEC-5: "false" (default) | "true". Rate limiting keys on req.ip; behind a
   * reverse proxy that would be the proxy's IP, collapsing every user into one
   * rate-limit budget (and breaking the 10-sends/10-min OTP backstop in
   * production). Set "true" ONLY when a proxy (nginx/Render router) fronts the
   * app and the app port is not directly reachable — with a direct connection
   * Express would instead trust client-supplied X-Forwarded-For headers and
   * attackers could rotate fake IPs to bypass the limits.
   */
  @IsOptional()
  @IsBooleanString()
  TRUST_PROXY?: string;

  @IsString()
  DB_HOST!: string;

  @IsNumberString()
  DB_PORT!: string;

  @IsString()
  DB_USERNAME!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  DB_DATABASE!: string;

  @IsOptional()
  @IsBooleanString()
  DB_SYNCHRONIZE?: string;

  @IsOptional()
  @IsBooleanString()
  DB_LOGGING?: string;

  @IsOptional()
  @IsBooleanString()
  DB_SSL?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  REDIS_HOST?: string;

  @IsOptional()
  @IsNumberString()
  REDIS_PORT?: string;

  @IsOptional()
  @IsNumberString()
  REDIS_DB?: string;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @IsBooleanString()
  REDIS_TLS?: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 chars — generate with: openssl rand -base64 48' })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 chars — generate with: openssl rand -base64 48' })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsOptional()
  @IsNumberString()
  OTP_TTL_SECONDS?: string;

  @IsOptional()
  @IsNumberString()
  OTP_LENGTH?: string;

  @IsOptional()
  @IsBooleanString()
  OTP_DEV_MODE?: string;

  /**
   * Task 9: Explicit opt-in flag required to run 4-digit OTPs in production.
   * Without this flag, OTP_LENGTH defaults to 6 in production and any value < 6
   * is refused with a boot error.
   */
  @IsOptional()
  @IsBooleanString()
  ALLOW_4_DIGIT_OTP?: string;

  @IsOptional()
  @IsBooleanString()
  PAYMENTS_DEV_MODE?: string;

  /**
   * Pass-4 (task 5): Razorpay webhook signing secret. Optional in
   * development (the webhook endpoint fails closed with 401 when unset);
   * required in production when PAYMENTS_DEV_MODE is not "true" — see the
   * production block below.
   */
  @IsOptional()
  @IsString()
  RAZORPAY_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  GOOGLE_WEB_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  APPLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  ADMIN_PHONES?: string;

  @IsOptional()
  @IsString()
  UPLOAD_DIR?: string;

  @IsOptional()
  @IsNumberString()
  MAX_UPLOAD_MB?: string;

  // ── Cloudinary storage (driver documents + avatars) ──
  @IsOptional()
  @IsIn(['cloudinary', 'local'])
  STORAGE_DRIVER?: string;

  // Pass-4 (task 10): when "true", the billable photo proxy
  // (GET /places/photo/*) requires a verifiable access token instead of
  // serving anonymous traffic. Default off so existing APKs (whose <Image>
  // never sends a header) keep rendering; the owner flips it after rollout.
  // Strictly "true" | "false": the photo controller only treats the exact string
  // "true" as ON, so a typo such as "True" or "1" must fail at boot instead of
  // silently leaving the billable photo proxy public.
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'REQUIRE_AUTH_FOR_PHOTOS must be exactly "true" or "false"' })
  REQUIRE_AUTH_FOR_PHOTOS?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_CLOUD_NAME?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_KEY?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_SECRET?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_FOLDER?: string;

  @IsOptional()
  @IsNumberString()
  CLOUDINARY_SIGNED_URL_TTL_SECONDS?: string;

  @IsOptional()
  @IsBooleanString()
  DB_SSL_REJECT_UNAUTHORIZED?: string;

  /**
   * Pass-4 script guard: scripts that WRITE to the database refuse any
   * non-local DB host unless they were started with
   * `--i-understand-this-is-a-remote-database` AND this is "true".
   * Never set it in production.
   */
  @IsOptional()
  @IsBooleanString()
  ALLOW_REMOTE_DB_WRITES?: string;

  /** Pass-4: integration suite may target a remote test DB when "1". */
  @IsOptional()
  @IsString()
  TEST_DB_ALLOW_REMOTE?: string;

  /** Mapbox Directions token for routed fare distances (R-7); optional —
   * without it estimates fall back to straight-line x1.3. */
  @IsOptional()
  @IsString()
  MAPBOX_TOKEN?: string;

  @IsOptional()
  @IsString()
  GOOGLE_PLACES_API_KEY?: string;

  @IsOptional()
  @IsString()
  PUBLIC_API_URL?: string;

  @IsOptional()
  @IsNumberString()
  DRIVER_SEARCH_RADIUS_METERS?: string;

  @IsOptional()
  @IsNumberString()
  DRIVER_LOCATION_STALE_SECONDS?: string;

  // How long an ONLINE driver may go without a location ping and still be
  // visible / offered rides (parked, phone locked, no GPS indoors). Default
  // 900 (15 min); clamped to 90 - 21600. 90 = the old strict behaviour.
  @IsOptional()
  @IsNumberString()
  DRIVER_PRESENCE_GRACE_SECONDS?: string;

  @IsOptional()
  @IsNumberString()
  RIDE_REQUEST_TIMEOUT_SECONDS?: string;

  // R-1: how long a ride may sit in `requested` with no driver offer
  // before the server auto-cancels it with `no_drivers_available`.
  @IsOptional()
  @IsNumberString()
  RIDE_SEARCH_TIMEOUT_SECONDS?: string;

  // AU-1: per-phone OTP send limits.
  @IsOptional()
  @IsNumberString()
  OTP_SEND_MAX?: string;

  @IsOptional()
  @IsNumberString()
  OTP_SEND_WINDOW_SECONDS?: string;

  @IsOptional()
  @IsNumberString()
  OTP_RESEND_COOLDOWN_SECONDS?: string;

  // R-6: day-boundary timezone for "today's earnings" and admin stats.
  @IsOptional()
  @IsString()
  APP_TIMEZONE?: string;

  // Pass-4 (task 6): hard trip-fraud limits. MAX_TRIP_KM caps the routed
  // distance a booking may request (default 150); SERVICE_AREA_BBOX
  // ("minLat,minLng,maxLat,maxLng") restricts both trip points to a region
  // when set.
  @IsOptional()
  @IsNumberString()
  MAX_TRIP_KM?: string;

  @IsOptional()
  @IsString()
  SERVICE_AREA_BBOX?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e: any) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  const redis = validated as unknown as Record<string, unknown>;
  if (!redis.REDIS_URL && (!redis.REDIS_HOST || !redis.REDIS_PORT)) {
    throw new Error('Invalid environment configuration:\nREDIS_URL or both REDIS_HOST and REDIS_PORT are required');
  }
  if (typeof redis.REDIS_URL === 'string' && redis.REDIS_URL.trim()) {
    try {
      const protocol = new URL(redis.REDIS_URL).protocol;
      if (protocol !== 'redis:' && protocol !== 'rediss:') {
        throw new Error('unsupported scheme');
      }
    } catch {
      throw new Error('Invalid environment configuration:\nREDIS_URL must use redis:// or rediss://');
    }
  }

  // Fail fast on placeholder secrets — they are committed in .env.example only.
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const v = (validated as unknown as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.startsWith('change_me')) {
      throw new Error(
        `Invalid environment configuration:\n${key} still has placeholder value "change_me_*" — generate a real secret (openssl rand -base64 48)`,
      );
    }
  }

  // Pass-4 (task 6): a malformed SERVICE_AREA_BBOX would silently disable
  // the service-area check, so fail at boot instead of at trip time.
  const bbox = (validated as unknown as Record<string, unknown>).SERVICE_AREA_BBOX;
  if (bbox !== undefined && bbox !== null && bbox !== '') {
    const parts = String(bbox)
      .split(',')
      .map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(
        'Invalid environment configuration:\nSERVICE_AREA_BBOX must be "minLat,minLng,maxLat,maxLng" (four comma-separated numbers)',
      );
    }
  }

  // Dev-mode providers & CORS rules must be enforced in production
  if ((validated as unknown as Record<string, unknown>).NODE_ENV === 'production') {
    for (const key of ['OTP_DEV_MODE', 'PAYMENTS_DEV_MODE'] as const) {
      if ((validated as unknown as Record<string, unknown>)[key] === 'true') {
        throw new Error(`Invalid environment configuration:\n${key} must not be "true" in production`);
      }
    }
    if ((validated as unknown as Record<string, unknown>).DB_SYNCHRONIZE === 'true') {
      throw new Error('Invalid environment configuration:\nDB_SYNCHRONIZE must never be "true" in production');
    }

    // Task 9: OTP_LENGTH defaults to 6 in production. Refuse < 6 unless ALLOW_4_DIGIT_OTP=true.
    const otpLen = (validated as unknown as Record<string, unknown>).OTP_LENGTH;
    const allow4Digit = (validated as unknown as Record<string, unknown>).ALLOW_4_DIGIT_OTP === 'true';
    if (otpLen !== undefined && Number(otpLen) < 6 && !allow4Digit) {
      throw new Error(
        'Invalid environment configuration:\nOTP_LENGTH must be >= 6 in production. ' +
        'To support legacy 4-digit client apps temporarily, set ALLOW_4_DIGIT_OTP=true explicitly.',
      );
    }
    const cors = (validated as unknown as Record<string, unknown>).CORS_ORIGIN;
    if (cors === '*' || !cors) {
      throw new Error('Invalid environment configuration:\nCORS_ORIGIN must not be "*" or empty in production');
    }
    const env = validated as unknown as Record<string, unknown>;
    if (env.STORAGE_DRIVER !== 'local') {
      for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const) {
        if (!env[key]) {
          throw new Error(`Invalid environment configuration:\n${key} is required in production (Cloudinary storage)`);
        }
      }
    }
    // Pass-4 (task 5): without the webhook secret every delivery would be
    // rejected (401), so a gateway-settled payment could never reach the
    // server — required in production unless dev-mode payments are on.
    if (env.PAYMENTS_DEV_MODE !== 'true' && !env.RAZORPAY_WEBHOOK_SECRET) {
      throw new Error(
        'Invalid environment configuration:\nRAZORPAY_WEBHOOK_SECRET is required in production when PAYMENTS_DEV_MODE is false',
      );
    }
    // OTP login is the primary sign-in path. OTP_DEV_MODE is already refused
    // in production above, so the real SMS provider is the only one in use —
    // without these keys Msg91SmsProvider silently returns { sent: false } and
    // every login code is lost. Fail at boot instead of at the first login.
    const rawEnv = config as Record<string, unknown>;
    for (const key of ['MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID'] as const) {
      const v = rawEnv[key];
      if (typeof v !== 'string' || v.trim() === '') {
        throw new Error(
          `Invalid environment configuration:\n${key} is required in production (OTP SMS delivery)`,
        );
      }
    }
    const publicUrl = (validated as unknown as Record<string, unknown>).PUBLIC_API_URL;
    if (!publicUrl || typeof publicUrl !== 'string' || !publicUrl.startsWith('https://')) {
      throw new Error('Invalid environment configuration:\nPUBLIC_API_URL must be a valid https:// URL in production');
    }
    // SEC-2a: both sign-in libraries SKIP the audience check entirely when the
    // audience is undefined (google-auth-library only verifies aud "if we have
    // one"; apple-signin-auth spreads it straight into jsonwebtoken options),
    // so without these a token minted for ANY other app would be accepted —
    // a classic account takeover. Required in production, and the service
    // itself fails closed with 503 when unset (AuthService).
    const socialEnv = validated as unknown as Record<string, unknown>;
    for (const key of ['GOOGLE_WEB_CLIENT_ID', 'APPLE_CLIENT_ID'] as const) {
      if (!socialEnv[key]) {
        throw new Error(
          `Invalid environment configuration:\n${key} is required in production (social sign-in audience)`,
        );
      }
    }
  }

  return validated;
}
