import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Task 18: Structured JSON logging middleware with request correlation ID.
 *
 * Adopts incoming `x-request-id` (e.g. from load balancer / proxy) or generates
 * a fresh UUID. Attaches the id to the response header `X-Request-Id`.
 * On finish, emits a single structured JSON log line with latency, status code,
 * method, path, and client IP.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawId = req.headers['x-request-id'];
    const requestId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();

    res.on('finish', () => {
      // Don't log health probe noise unless degraded
      if (req.originalUrl === '/health' && res.statusCode === 200) return;

      const durationMs = Date.now() - start;
      const logEntry = {
        timestamp: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs,
        ip: req.ip || req.socket?.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      };

      // Emit as single-line structured JSON
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(logEntry));
    });

    next();
  }
}
