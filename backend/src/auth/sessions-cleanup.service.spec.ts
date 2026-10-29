import { SessionsCleanupService, SESSION_RETENTION_MS } from './sessions-cleanup.service';
import { RefreshSessionEntity } from './entities/refresh-session.entity';
import { Repository } from 'typeorm';

describe('SessionsCleanupService', () => {
  const build = (execute: jest.Mock) => {
    const qb: any = {
      delete: jest.fn(() => qb),
      where: jest.fn(() => qb),
      execute,
    };
    const sessions = { createQueryBuilder: jest.fn(() => qb) };
    return {
      service: new SessionsCleanupService(sessions as unknown as Repository<RefreshSessionEntity>),
      qb,
    };
  };

  it('deletes sessions expired or revoked beyond the retention window', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 3 });
    const { service, qb } = build(execute);
    const now = new Date('2026-10-29T12:00:00.000Z');

    await expect(service.purge(now)).resolves.toBe(3);

    expect(qb.delete).toHaveBeenCalled();
    expect(qb.where).toHaveBeenCalledWith('"revokedAt" < :cutoff OR "expiresAt" < :cutoff', {
      cutoff: new Date(now.getTime() - SESSION_RETENTION_MS),
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a table with nothing dead yet', async () => {
    const { service } = build(jest.fn().mockResolvedValue({ affected: 0 }));
    await expect(service.purge()).resolves.toBe(0);
  });

  it('never throws when housekeeping fails (boot must not break)', async () => {
    const { service } = build(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(service.purge()).resolves.toBe(0);
  });
});
