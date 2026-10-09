// class-transformer/class-validator read decorator metadata — nothing else in
// this suite pulls in the Nest bootstrap that normally imports this first.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

/**
 * SEC-2a: GOOGLE_WEB_CLIENT_ID / APPLE_CLIENT_ID are REQUIRED in production.
 * Without an audience both sign-in libraries skip the aud check entirely
 * (google-auth-library only verifies aud "if we have one"; apple-signin-auth
 * spreads { audience: undefined } into jsonwebtoken options), so any token
 * minted for another app would be accepted — a classic account takeover.
 * AuthService also fails closed with 503 when the variable is missing.
 */
describe('validateEnv (SEC-2a social sign-in audiences)', () => {
  const required: Record<string, string> = {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USERNAME: 'user',
    DB_PASSWORD: 'pass',
    DB_DATABASE: 'vazhi',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
  };

  const prodBase = (): Record<string, string> => ({
    ...required,
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://app.example',
    PUBLIC_API_URL: 'https://api.example',
    STORAGE_DRIVER: 'local',
  });

  it('fails boot when GOOGLE_WEB_CLIENT_ID is missing in production', () => {
    expect(() => validateEnv(prodBase())).toThrow('GOOGLE_WEB_CLIENT_ID is required in production');
  });

  it('fails boot when APPLE_CLIENT_ID is missing in production', () => {
    const env = prodBase();
    env.GOOGLE_WEB_CLIENT_ID = 'gid.apps.example.com';
    expect(() => validateEnv(env)).toThrow('APPLE_CLIENT_ID is required in production');
  });

  it('accepts production when both audiences are set', () => {
    const env = prodBase();
    env.GOOGLE_WEB_CLIENT_ID = 'gid.apps.example.com';
    env.APPLE_CLIENT_ID = 'com.example.app';
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('keeps both optional outside production (dev machines without social login)', () => {
    expect(() => validateEnv({ ...required, NODE_ENV: 'development' })).not.toThrow();
  });
});
