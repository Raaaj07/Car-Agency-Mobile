/**
 * Opt-in integration suite (Task 11) — real Postgres, real SQL.
 *
 *   docker compose -f docker-compose.test.yml up -d --wait
 *   INTEGRATION=1 npm run test:integration    # PowerShell: $env:INTEGRATION='1'
 *
 * Excluded from the default `npx jest` run via jest.config.js's
 * testPathIgnorePatterns; the specs additionally gate on INTEGRATION=1
 * themselves (double safety) and only ever connect to the TEST_DB_* database
 * (default `vazhi_test`) — never the dev database.
 */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['**/*.integration.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 60000, // first run may CREATE the database + run 12 migrations
  maxWorkers: 1, // one shared test database — no parallel writers
};
