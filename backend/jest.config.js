/**
 * Jest config for the backend (T-1 — the repo previously had zero tests).
 * Tests live next to the code as `*.spec.ts`; `tsconfig.build.json` excludes
 * them from `nest build`, so they never ship to dist.
 *
 * `*.integration.spec.ts` files are opt-in (real Postgres) and run through
 * `jest.integration.config.js` instead — plain `npx jest` stays unit-only.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  clearMocks: true,
  // Keep test output readable: Nest's Logger prints per-call otherwise.
  silent: false,
};
