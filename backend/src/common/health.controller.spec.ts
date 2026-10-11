import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

/**
 * Pass-4 (task 9): /health answers `{ status }` only; either dependency
 * failing a trivial round-trip turns the probe into 503 degraded, and the
 * body never leaks version/host/error text.
 */
describe('HealthController (pass-4 task-9)', () => {
  type Res = { status: jest.Mock; json: jest.Mock };
  const fakeRes = (): Res => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  const build = (query: jest.Mock, ping: jest.Mock) =>
    new HealthController(
      { query } as unknown as DataSource,
      { ping } as unknown as Redis,
    );

  it('answers 200 { status: "ok" } when DB and Redis both answer', async () => {
    const res = fakeRes();

    await build(
      jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      jest.fn().mockResolvedValue('PONG'),
    ).check(res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('answers 503 { status: "degraded" } when SELECT 1 fails', async () => {
    const res = fakeRes();

    await build(
      jest.fn().mockRejectedValue(new Error('db down')),
      jest.fn().mockResolvedValue('PONG'),
    ).check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ status: 'degraded' });
  });

  it('answers 503 { status: "degraded" } when Redis PING fails', async () => {
    const res = fakeRes();

    await build(
      jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      jest.fn().mockRejectedValue(new Error('redis down')),
    ).check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ status: 'degraded' });
  });

  it('leaks nothing but the status word', async () => {
    const res = fakeRes();

    await build(
      jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED secret-db.internal:5432')),
      jest.fn().mockResolvedValue('PONG'),
    ).check(res as never);

    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(
      /secret|internal|ECONNREFUSED|version/i,
    );
  });
});
