import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProd = (config.get<string>('NODE_ENV') ?? 'development') === 'production';

  app.setGlobalPrefix(config.get<string>('API_PREFIX') ?? 'api/v1');
  // AU-1: baseline security headers (CSP/HSTS/frame options etc.) — harmless
  // for a JSON API, meaningful for any HTML/error pages it might serve.
  app.use(helmet());
  // CORS_ORIGIN may be "*" in dev, or a comma-separated allowlist in prod.
  const rawOrigin = config.get<string>('CORS_ORIGIN') ?? '*';
  const origin =
    rawOrigin === '*' ? (isProd ? false : '*') : rawOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const port = Number(config.get<string>('PORT') ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Vazhi backend listening on :${port}`);
}

bootstrap();
