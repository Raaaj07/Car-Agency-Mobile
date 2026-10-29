/**
 * Frontend unit tests: pure helpers only (no native modules, no renderer).
 * Money/format/UPI/distance logic is where a silent change costs real money,
 * so it is the first layer of the frontend test net.
 *
 * `isolatedModules` skips per-file type-checking (slow on TS 6); the CI
 * `tsc --noEmit` gate already type-checks the whole project.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', rootDir: '.' } }],
  },
};
