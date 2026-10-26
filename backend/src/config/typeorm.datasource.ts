import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { resolveDbSsl } from './db-ssl';

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});

if ((process.env.NODE_ENV ?? 'development') === 'production' && process.env.DB_SYNCHRONIZE === 'true') {
  throw new Error('DB_SYNCHRONIZE must never be true in production — use migrations');
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'vazhi',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  logging: process.env.DB_LOGGING === 'true',
  ssl: resolveDbSsl(process.env),
};

// TypeORM CLI (`npm run migration:*`) loads this file and expects a
// DataSource instance export.
export default new DataSource(dataSourceOptions);