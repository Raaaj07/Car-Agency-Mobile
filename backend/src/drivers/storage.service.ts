import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type DocumentKind = 'licenseImage' | 'rcImage' | 'vehiclePhoto';

const ALLOWED: Record<string, { ext: string; magic: Buffer[] }> = {
  'image/jpeg': { ext: 'jpg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
  'image/png': { ext: 'png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
  'application/pdf': { ext: 'pdf', magic: [Buffer.from('%PDF')] },
};

export interface StoredDocument {
  kind: DocumentKind;
  path: string;
  mime: string;
  size: number;
}

/**
 * Local-disk implementation. Files land in <UPLOAD_DIR>/<userId>/ (default
 * <cwd>/uploads/) and are served only through authenticated endpoints (never
 * express.static).
 * NOTE: local disk is lost on ephemeral hosts (Docker without a volume, many
 * PaaS) — swap this service for S3/R2 before production (see CHANGES.md).
 */
@Injectable()
export class StorageService {
  private readonly dir: string;
  private readonly maxBytes: number;

  constructor(private readonly config: ConfigService) {
    // Resolved against the server working directory (UPLOAD_DIR overrides).
    this.dir = config.get<string>('UPLOAD_DIR') ?? path.resolve(process.cwd(), 'uploads');
    const mb = Number(config.get<string>('MAX_UPLOAD_MB') ?? 5);
    this.maxBytes = (Number.isFinite(mb) ? mb : 5) * 1024 * 1024;
  }

  validateAndStore(userId: string, kind: DocumentKind, file: Express.Multer.File): StoredDocument {
    if (!file?.buffer?.length) throw new BadRequestException(`${kind}: empty file`);
    if (file.size > this.maxBytes) {
      throw new BadRequestException(`${kind}: exceeds ${Math.round(this.maxBytes / 1024 / 1024)} MB`);
    }
    const rule = ALLOWED[file.mimetype];
    if (!rule) throw new BadRequestException(`${kind}: only JPEG, PNG or PDF allowed`);
    const ok = rule.magic.some((m) => file.buffer.subarray(0, m.length).equals(m));
    if (!ok) throw new BadRequestException(`${kind}: file content does not match ${file.mimetype}`);
    const safeUser = userId.replace(/[^a-f0-9-]/gi, '');
    const dir = path.resolve(this.dir, safeUser);
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.resolve(dir, `${kind}-${randomUUID()}.${rule.ext}`);
    if (!abs.startsWith(path.resolve(this.dir))) throw new BadRequestException('Invalid storage path');
    fs.writeFileSync(abs, file.buffer);
    return { kind, path: abs, mime: file.mimetype, size: file.size };
  }

  readAbsolute(abs: string): { buffer: Buffer; mime: string } {
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(path.resolve(this.dir))) throw new BadRequestException('Invalid file path');
    if (!fs.existsSync(resolved)) throw new BadRequestException('Document not found');
    const buf = fs.readFileSync(resolved);
    const mime = resolved.endsWith('.png')
      ? 'image/png'
      : resolved.endsWith('.pdf')
        ? 'application/pdf'
        : 'image/jpeg';
    return { buffer: buf, mime };
  }

  private static readonly AVATAR_ALLOWED: Record<string, { ext: string; magic: Buffer[] }> = {
    'image/jpeg': { ext: 'jpg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
    'image/png': { ext: 'png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
  };

  // Profile photos: JPEG/PNG only, 2 MB max, stored under avatars/<userId>/.
  // Returns the stored file name (the DB keeps only this, never a file:// URI).
  validateAndStoreAvatar(userId: string, file: Express.Multer.File): string {
    if (!file?.buffer?.length) throw new BadRequestException('avatar: empty file');
    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('avatar: exceeds 2 MB');
    }
    const rule = StorageService.AVATAR_ALLOWED[file.mimetype];
    if (!rule) throw new BadRequestException('avatar: only JPEG or PNG allowed');
    const ok = rule.magic.some((m) => file.buffer.subarray(0, m.length).equals(m));
    if (!ok) throw new BadRequestException('avatar: file content does not match its type');
    const safeUser = userId.replace(/[^a-f0-9-]/gi, '');
    const dir = path.resolve(this.dir, 'avatars', safeUser);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${randomUUID()}.${rule.ext}`;
    fs.writeFileSync(path.resolve(dir, name), file.buffer);
    return name;
  }

  readAvatar(userId: string, name: string): { buffer: Buffer; mime: string } {
    const safeUser = userId.replace(/[^a-f0-9-]/gi, '');
    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '');
    const resolved = path.resolve(this.dir, 'avatars', safeUser, safeName);
    if (!resolved.startsWith(path.resolve(this.dir, 'avatars'))) {
      throw new BadRequestException('Invalid file path');
    }
    if (!fs.existsSync(resolved)) throw new BadRequestException('Avatar not found');
    return {
      buffer: fs.readFileSync(resolved),
      mime: resolved.endsWith('.png') ? 'image/png' : 'image/jpeg',
    };
  }
}
