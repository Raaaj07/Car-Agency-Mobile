/**
 * Jest config for the backend (T-1 — the repo previously had zero tests).
 * Tests live next to the code as `*.spec.ts`; `tsconfig.build.json` excludes
 * them from `nest build`, so they never ship to dist.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  clearMocks: true,
  // Keep test output readable: Nest's Logger prints per-call otherwise.
  silent: false,
};
