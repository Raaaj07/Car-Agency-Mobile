import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageService } from './storage.service';

describe('StorageService (Task 8)', () => {
  let service: StorageService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vazhi-storage-test-'));
    service = new StorageService({
      get: (k: string) => {
        if (k === 'STORAGE_DRIVER') return 'local';
        if (k === 'UPLOAD_DIR') return tempDir;
        return undefined;
      },
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('stores and reads an avatar using async fs operations', async () => {
    // Valid PNG header magic bytes
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const file = {
      buffer: pngMagic,
      mimetype: 'image/png',
      size: pngMagic.length,
    } as Express.Multer.File;

    const storedName = await service.storeAvatar('user-1', file);
    expect(storedName).toMatch(/\.png$/);

    const read = await service.readAvatar('user-1', storedName);
    expect(read.buffer).toEqual(pngMagic);
    expect(read.mime).toBe('image/png');
  });

  it('rejects path traversal attempts with path.relative check', async () => {
    await expect(service.readAvatar('user-1', '../../etc/passwd')).rejects.toThrow(
      BadRequestException,
    );
  });
});
