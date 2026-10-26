import { testDbTargetProblem } from './db-helpers';

describe('testDbTargetProblem (integration suite safety)', () => {
  const base = { database: 'vazhi_test', baseDatabase: 'vazhi', host: 'localhost', allowRemote: false };

  it('accepts the default local test target', () => {
    expect(testDbTargetProblem(base)).toBeNull();
  });

  it('accepts any name containing "test" case-insensitively', () => {
    expect(testDbTargetProblem({ ...base, database: 'VAZHI_TEST2' })).toBeNull();
    expect(testDbTargetProblem({ ...base, database: 'test_vazhi_ci' })).toBeNull();
  });

  it('refuses a database name without "test"', () => {
    expect(testDbTargetProblem({ ...base, database: 'vazhi_ci' })).toContain('contain "test"');
  });

  it('refuses to point the suite at the dev database', () => {
    expect(
      testDbTargetProblem({ ...base, database: 'vazhi', baseDatabase: 'vazhi', host: 'localhost' }),
    ).toContain('DB_DATABASE');
  });

  it('refuses a remote host without TEST_DB_ALLOW_REMOTE', () => {
    expect(testDbTargetProblem({ ...base, host: 'db.example.internal' })).toContain('TEST_DB_ALLOW_REMOTE=1');
  });

  it('accepts a remote host with TEST_DB_ALLOW_REMOTE=1', () => {
    expect(testDbTargetProblem({ ...base, host: 'db.example.internal', allowRemote: true })).toBeNull();
  });

  it('accepts the docker-compose aliases as local', () => {
    for (const host of ['postgres', 'db', '127.0.0.1', '::1']) {
      expect(testDbTargetProblem({ ...base, host })).toBeNull();
    }
  });
});
