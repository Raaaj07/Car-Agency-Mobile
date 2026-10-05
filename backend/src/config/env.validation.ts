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

  @IsString()
  REDIS_HOST!: string;

  @IsNumberString()
  REDIS_PORT!: string;

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

  @IsOptional()
  @IsBooleanString()
  PAYMENTS_DEV_MODE?: string;

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

  // Fail fast on placeholder secrets — they are committed in .env.example only.
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const v = (validated as unknown as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.startsWith('change_me')) {
      throw new Error(
        `Invalid environment configuration:\n${key} still has placeholder value "change_me_*" — generate a real secret (openssl rand -base64 48)`,
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
    const publicUrl = (validated as unknown as Record<string, unknown>).PUBLIC_API_URL;
    if (!publicUrl || typeof publicUrl !== 'string' || !publicUrl.startsWith('https://')) {
      throw new Error('Invalid environment configuration:\nPUBLIC_API_URL must be a valid https:// URL in production');
    }
  }

  return validated;
}
