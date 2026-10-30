import { ConfigService } from '@nestjs/config';
import { redisConnectionConfig } from './redis.module';

const config = (values: Record<string, string | undefined>) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

describe('redisConnectionConfig', () => {
  it('uses REDIS_URL as the one canonical endpoint and does not override its scheme with REDIS_TLS', () => {
    const url = ['redis:', '//unit-test.invalid:18221/3'].join('');
    const result = redisConnectionConfig(
      config({ REDIS_URL: url, REDIS_HOST: 'ignored.invalid', REDIS_PORT: '9999', REDIS_TLS: 'true' }),
    );

    expect(result.url).toBe(url);
    expect(result.options.tls).toBeUndefined();
    expect(result.options.enableOfflineQueue).toBe(false);
    expect(result.options.commandTimeout).toBe(4_000);
  });

  it('falls back to explicit host, port, database and TLS configuration', () => {
    const result = redisConnectionConfig(
      config({ REDIS_HOST: 'unit-test.invalid', REDIS_PORT: '18221', REDIS_DB: '4', REDIS_TLS: 'true' }),
    );

    expect(result.url).toBeUndefined();
    expect(result.options).toMatchObject({ host: 'unit-test.invalid', port: 18221, db: 4, tls: {} });
  });
});
