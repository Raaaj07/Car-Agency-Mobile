import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisConnectionConfig } from '../../config/redis.module';

/**
 * Task 6: Redis adapter for Socket.IO multi-instance scaling.
 *
 * In a multi-instance deployment (e.g. Render autoscaling, multiple containers),
 * Socket.IO events (room broadcasts, user notifications) must reach clients
 * connected to other instances. @socket.io/redis-adapter handles pub/sub across
 * nodes.
 *
 * Fallback: If Redis is not configured or fails to connect (common in local dev),
 * falls back to the default in-memory single-instance adapter with a warning.
 */
export class RedisIoAdapter extends IoAdapter {
  // Named redisLogger: IoAdapter (Nest 11) already has a `logger` member.
  private readonly redisLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(config: ConfigService): Promise<void> {
    // The app configures Redis with REDIS_HOST / REDIS_PORT / REDIS_PASSWORD /
    // REDIS_TLS (see RedisModule); this adapter must read the SAME settings or
    // it silently never turns on. REDIS_URL is honoured too when someone sets it.
    const connection = redisConnectionConfig(config);
    if (!connection.url && !connection.options.host) {
      this.redisLogger.warn('No Redis configured — Socket.IO using single-instance in-memory adapter');
      return;
    }

    const options = {
      ...connection.options,
      connectTimeout: 5000,
      lazyConnect: true,
    };
    let pubClient: Redis | undefined;
    let subClient: Redis | undefined;
    try {
      pubClient = connection.url ? new Redis(connection.url, options) : new Redis(options);
      subClient = pubClient.duplicate();
      // Handlers first: an error during connect() must never be unhandled.
      pubClient.on('error', (err) => {
        this.redisLogger.error(`Redis pub client error: ${err.message}`);
      });
      subClient.on('error', (err) => {
        this.redisLogger.error(`Redis sub client error: ${err.message}`);
      });
      // Mid-run failure is the dangerous case: boot succeeded, then Redis (or
      // the network to it) died. Socket.IO keeps retrying in the background,
      // but cross-instance broadcast stops until it reconnects — say so
      // loudly instead of degrading silently.
      pubClient.on('reconnecting', () => {
        this.redisLogger.warn(
          'Redis connection lost — Socket.IO cross-instance broadcasts are retrying (realtime may be local-only until it recovers)',
        );
      });
      pubClient.on('ready', () => {
        this.redisLogger.log('Redis connection ready — Socket.IO cross-instance adapter active');
      });
      pubClient.on('end', () => {
        this.redisLogger.error('Redis connection closed — Socket.IO cross-instance broadcasts are degraded');
      });

      // With a retryStrategy, connect() keeps retrying instead of rejecting, so
      // bound it: an unreachable Redis must not hold up boot.
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all([pubClient.connect(), subClient.connect()]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('connect timeout (6s)')), 6000);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.redisLogger.log('Socket.IO Redis adapter connected and enabled');
    } catch (err) {
      this.redisLogger.warn(
        `Failed to connect to Redis for Socket.IO adapter (${(err as Error).message}) — falling back to single-instance adapter`,
      );
      this.adapterConstructor = undefined;
      // Don't leave half-open clients retrying forever in the background.
      pubClient?.disconnect();
      subClient?.disconnect();
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
