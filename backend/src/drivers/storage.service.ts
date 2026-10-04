import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiOptions, UploadApiResponse } from 'cloudinary';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type DocumentKind = 'licenseImage' | 'rcImage' | 'vehiclePhoto';

interface AllowedType {
  ext: string;
  magic: Buffer[];
}

const JPEG: AllowedType = { ext: 'jpg', magic: [Buffer.from([0xff, 0xd8, 0xff])] };
const PNG: AllowedType = {
  ext: 'png',
  magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
};
const PDF: AllowedType = { ext: 'pdf', magic: [Buffer.from('%PDF')] };

const DOCUMENT_TYPES: Record<string, AllowedType> = {
  'image/jpeg': JPEG,
  'image/png': PNG,
  'application/pdf': PDF,
};
const AVATAR_TYPES: Record<string, AllowedType> = {
  'image/jpeg': JPEG,
  'image/png': PNG,
};

const MIME_BY_FORMAT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

/**
 * What is stored in drivers.licenseImagePath / rcImagePath / vehiclePhotoPath.
 * Cloudinary documents are stored as a small JSON string in the existing TEXT
 * columns (no migration needed). Legacy rows still hold an absolute local path
 * and keep working through the local-disk fallback below.
 */
export interface CloudinaryRef {
  provider: 'cloudinary';
  publicId: string;
  resourceType: 'image' | 'raw';
  format: string; // jpg | png | pdf
  mime: string;
  bytes: number;
}

export interface StoredDocument {
  kind: DocumentKind;
  /** Value to persist in the DB column (Cloudinary JSON ref or local path). */
  path: string;
  mime: string;
  size: number;
}

export type DocumentAccess =
  | { type: 'url'; url: string; mime: string; expiresAt: string }
  | { type: 'buffer'; buffer: Buffer; mime: string };

type Driver = 'cloudinary' | 'local';

/**
 * Storage facade used by drivers / admin / auth.
 *
 *  - STORAGE_DRIVER=cloudinary (default when CLOUDINARY_* are set):
 *      driver documents -> Cloudinary `authenticated` delivery (private; only
 *      reachable through short-lived signed URLs minted for admins);
 *      avatars          -> Cloudinary public delivery (stored as https URL).
 *  - STORAGE_DRIVER=local: the previous local-disk behaviour (dev only).
 *
 * Magic-byte / size validation is identical for both drivers.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: Driver;
  private readonly dir: string; // local driver + legacy files
  private readonly maxBytes: number;
  private readonly rootFolder: string;
  private readonly signedUrlTtl: number;

  constructor(private readonly config: ConfigService) {
    this.dir = config.get<string>('UPLOAD_DIR') ?? path.resolve(process.cwd(), 'uploads');
    const mb = Number(config.get<string>('MAX_UPLOAD_MB') ?? 5);
    this.maxBytes = (Number.isFinite(mb) ? mb : 5) * 1024 * 1024;
    this.rootFolder = (config.get<string>('CLOUDINARY_FOLDER') ?? 'vazhi').replace(/^\/+|\/+$/g, '');
    const ttl = Number(config.get<string>('CLOUDINARY_SIGNED_URL_TTL_SECONDS') ?? 600);
    this.signedUrlTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 600;

    const cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = config.get<string>('CLOUDINARY_API_SECRET');
    const hasCreds = !!(cloudName && apiKey && apiSecret);
    const wanted = config.get<string>('STORAGE_DRIVER');

    this.driver = wanted === 'local' ? 'local' : wanted === 'cloudinary' || hasCreds ? 'cloudinary' : 'local';

    if (this.driver === 'cloudinary') {
      if (!hasCreds) {
        throw new Error(
          'STORAGE_DRIVER=cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET',
        );
      }
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    } else if ((config.get<string>('NODE_ENV') ?? 'development') === 'production') {
      this.logger.warn('Using LOCAL disk storage in production — uploads are lost on ephemeral hosts.');
    }
  }

  // ───────────────────────── validation (shared) ─────────────────────────

  private validate(
    label: string,
    file: Express.Multer.File,
    allowed: Record<string, AllowedType>,
    maxBytes: number,
  ): AllowedType {
    if (!file?.buffer?.length) throw new BadRequestException(`${label}: empty file`);
    if (file.size > maxBytes) {
      throw new BadRequestException(`${label}: exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    const rule = allowed[file.mimetype];
    if (!rule) {
      throw new BadRequestException(
        `${label}: only ${Object.values(allowed).map((a) => a.ext.toUpperCase()).join(', ')} allowed`,
      );
    }
    const ok = rule.magic.some((m) => file.buffer.subarray(0, m.length).equals(m));
    if (!ok) throw new BadRequestException(`${label}: file content does not match ${file.mimetype}`);
    return rule;
  }

  private safeId(id: string): string {
    return id.replace(/[^a-f0-9-]/gi, '');
  }

  // ───────────────────────── driver documents ─────────────────────────

  async storeDocument(userId: string, kind: DocumentKind, file: Express.Multer.File): Promise<StoredDocument> {
    const rule = this.validate(kind, file, DOCUMENT_TYPES, this.maxBytes);

    if (this.driver === 'local') {
      return this.storeDocumentLocal(userId, kind, file, rule);
    }

    const safeUser = this.safeId(userId);
    let res: UploadApiResponse;
    try {
      res = await this.uploadBuffer(file.buffer, {
        folder: `${this.rootFolder}/drivers/${safeUser}`,
        public_id: `${kind}-${randomUUID()}`,
        resource_type: 'image', // Cloudinary stores PDFs under the "image" resource type
        type: 'authenticated', // private: no public URL exists for this asset
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        tags: ['driver-document', kind],
      });
    } catch (err) {
      this.logger.error(`Cloudinary upload failed for ${kind}: ${(err as Error)?.message ?? err}`);
      throw new BadGatewayException(`${kind}: upload failed, please try again`);
    }

    const ref: CloudinaryRef = {
      provider: 'cloudinary',
      publicId: res.public_id,
      resourceType: 'image',
      format: res.format ?? rule.ext,
      mime: file.mimetype,
      bytes: res.bytes ?? file.size,
    };
    return { kind, path: JSON.stringify(ref), mime: file.mimetype, size: file.size };
  }

  /**
   * Resolve a stored document for an admin. Cloudinary docs come back as a
   * short-lived signed URL (the client downloads straight from Cloudinary);
   * legacy local files come back as bytes.
   */
  async getDocumentAccess(stored: string): Promise<DocumentAccess> {
    const ref = this.parseRef(stored);
    if (ref) {
      const expiresAtSec = Math.floor(Date.now() / 1000) + this.signedUrlTtl;
      const url = cloudinary.utils.private_download_url(ref.publicId, ref.format, {
        resource_type: ref.resourceType,
        type: 'authenticated',
        expires_at: expiresAtSec,
      });
      return { type: 'url', url, mime: ref.mime, expiresAt: new Date(expiresAtSec * 1000).toISOString() };
    }
    if (/^https:\/\//i.test(stored)) {
      // Legacy remote URL columns (drivingLicenceImageUrl, ...).
      return { type: 'url', url: stored, mime: this.mimeFromName(stored), expiresAt: '' };
    }
    const local = this.readLocalAbsolute(stored);
    return { type: 'buffer', ...local };
  }

  /** Best-effort delete (orphan cleanup after failed/replaced applications). */
  async deleteDocument(stored?: string | null): Promise<void> {
    if (!stored) return;
    const ref = this.parseRef(stored);
    if (!ref) return; // legacy local files are left alone
    try {
      await cloudinary.uploader.destroy(ref.publicId, {
        resource_type: ref.resourceType,
        type: 'authenticated',
        invalidate: true,
      });
    } catch (err) {
      this.logger.warn(`Cloudinary delete failed for ${ref.publicId}: ${(err as Error)?.message ?? err}`);
    }
  }

  // ───────────────────────── avatars ─────────────────────────

  /**
   * Returns what to persist in users.avatar:
   *  - cloudinary: the https delivery URL (users.avatar is varchar(500))
   *  - local: the stored file name (legacy behaviour)
   */
  async storeAvatar(userId: string, file: Express.Multer.File): Promise<string> {
    const rule = this.validate('avatar', file, AVATAR_TYPES, 2 * 1024 * 1024);

    if (this.driver === 'local') return this.storeAvatarLocal(userId, file, rule);

    try {
      const res = await this.uploadBuffer(file.buffer, {
        folder: `${this.rootFolder}/avatars`,
        public_id: this.safeId(userId),
        overwrite: true, // one avatar per user -> old image is replaced, nothing orphaned
        invalidate: true,
        resource_type: 'image',
        type: 'upload',
        // Stored already resized: 512px square, face-aware crop, auto quality.
        transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'auto' }, { quality: 'auto' }],
        tags: ['avatar'],
      });
      return res.secure_url;
    } catch (err) {
      this.logger.error(`Cloudinary avatar upload failed: ${(err as Error)?.message ?? err}`);
      throw new BadGatewayException('avatar: upload failed, please try again');
    }
  }

  /** Legacy local avatars only (Cloudinary avatars are plain https URLs). */
  readAvatar(userId: string, name: string): { buffer: Buffer; mime: string } {
    const safeUser = this.safeId(userId);
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

  // ───────────────────────── internals ─────────────────────────

  private uploadBuffer(buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(options, (err, res) => {
        if (err || !res) return reject(err ?? new Error('Empty Cloudinary response'));
        resolve(res);
      });
      stream.end(buffer);
    });
  }

  private parseRef(stored: string): CloudinaryRef | null {
    if (!stored || stored[0] !== '{') return null;
    try {
      const v = JSON.parse(stored) as Partial<CloudinaryRef>;
      if (v.provider === 'cloudinary' && v.publicId && v.format && v.resourceType && v.mime) {
        return v as CloudinaryRef;
      }
    } catch {
      /* not JSON -> legacy path */
    }
    return null;
  }

  private mimeFromName(name: string): string {
    const ext = name.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    return MIME_BY_FORMAT[ext] ?? 'image/jpeg';
  }

  // ── local-disk implementation (dev + legacy rows) ──

  private storeDocumentLocal(
    userId: string,
    kind: DocumentKind,
    file: Express.Multer.File,
    rule: AllowedType,
  ): StoredDocument {
    const dir = path.resolve(this.dir, this.safeId(userId));
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.resolve(dir, `${kind}-${randomUUID()}.${rule.ext}`);
    if (!abs.startsWith(path.resolve(this.dir))) throw new BadRequestException('Invalid storage path');
    fs.writeFileSync(abs, file.buffer);
    return { kind, path: abs, mime: file.mimetype, size: file.size };
  }

  private storeAvatarLocal(userId: string, file: Express.Multer.File, rule: AllowedType): string {
    const dir = path.resolve(this.dir, 'avatars', this.safeId(userId));
    fs.mkdirSync(dir, { recursive: true });
    const name = `${randomUUID()}.${rule.ext}`;
    fs.writeFileSync(path.resolve(dir, name), file.buffer);
    return name;
  }

  private readLocalAbsolute(abs: string): { buffer: Buffer; mime: string } {
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(path.resolve(this.dir))) throw new BadRequestException('Invalid file path');
    if (!fs.existsSync(resolved)) throw new NotFoundException('Document not found');
    return { buffer: fs.readFileSync(resolved), mime: this.mimeFromName(resolved) };
  }
}
