import {
  LOCAL_DB_HOSTS,
  REMOTE_DB_FLAG,
  ScriptSafetyInput,
  scriptSafetyProblem,
} from './db-guard';

const base: ScriptSafetyInput = {
  destructive: false,
  host: 'localhost',
  nodeEnv: 'development',
  argv: [],
};

describe('scriptSafetyProblem (db-guard)', () => {
  it('allows every local alias for read-only and destructive scripts', () => {
    for (const host of LOCAL_DB_HOSTS) {
      expect(scriptSafetyProblem({ ...base, host, destructive: false })).toBeNull();
      expect(scriptSafetyProblem({ ...base, host, destructive: true })).toBeNull();
    }
  });

  it('refuses a remote host without the flag and names host + flag', () => {
    const problem = scriptSafetyProblem({ ...base, host: 'db.example.internal', destructive: false });
    expect(problem).toContain('db.example.internal');
    expect(problem).toContain(REMOTE_DB_FLAG);
  });

  it('mentions ALLOW_REMOTE_DB_WRITES in destructive refusals', () => {
    const problem = scriptSafetyProblem({ ...base, host: 'db.example.internal', destructive: true });
    expect(problem).toContain(REMOTE_DB_FLAG);
    expect(problem).toContain('ALLOW_REMOTE_DB_WRITES=true');
  });

  it('allows a remote host with the flag for read-only scripts', () => {
    expect(
      scriptSafetyProblem({ ...base, host: 'db.example.internal', argv: [REMOTE_DB_FLAG], destructive: false }),
    ).toBeNull();
  });

  it('refuses a destructive remote script with the flag but no ALLOW_REMOTE_DB_WRITES', () => {
    const problem = scriptSafetyProblem({
      ...base,
      host: 'db.example.internal',
      argv: [REMOTE_DB_FLAG],
      destructive: true,
    });
    expect(problem).toContain(REMOTE_DB_FLAG);
    expect(problem).toContain('ALLOW_REMOTE_DB_WRITES=true');
  });

  it('refuses a destructive remote script with ALLOW_REMOTE_DB_WRITES but no flag', () => {
    const problem = scriptSafetyProblem({
      ...base,
      host: 'db.example.internal',
      destructive: true,
      allowRemoteWrites: 'true',
    });
    expect(problem).not.toBeNull();
    expect(problem).toContain(REMOTE_DB_FLAG);
  });

  it('allows a destructive remote script with BOTH the flag and ALLOW_REMOTE_DB_WRITES', () => {
    expect(
      scriptSafetyProblem({
        ...base,
        host: 'db.example.internal',
        argv: [REMOTE_DB_FLAG],
        destructive: true,
        allowRemoteWrites: 'true',
      }),
    ).toBeNull();
  });

  it('refuses production unconditionally, even local, even with the flag', () => {
    expect(scriptSafetyProblem({ ...base, nodeEnv: 'production' })).toContain('NODE_ENV=production');
    expect(
      scriptSafetyProblem({
        ...base,
        nodeEnv: 'production',
        argv: [REMOTE_DB_FLAG],
        destructive: true,
        allowRemoteWrites: 'true',
      }),
    ).toContain('NODE_ENV=production');
  });

  it('treats a missing NODE_ENV as development', () => {
    expect(scriptSafetyProblem({ ...base, nodeEnv: undefined })).toBeNull();
  });

  it('never echoes credentials — only host and flag appear in messages', () => {
    const problem = scriptSafetyProblem({ ...base, host: 'db.example.internal', destructive: true });
    // The pure input carries no password by design; assert the message shape
    // the spec demands (host + flag, nothing else about the target).
    expect(problem).not.toMatch(/password|username|database name/i);
    expect(problem).not.toContain('vazhi');
  });
});
