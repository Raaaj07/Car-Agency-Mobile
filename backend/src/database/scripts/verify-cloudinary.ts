/**
 * End-to-end verification of the Cloudinary avatar pipeline using the REAL
 * StorageService (same code path as POST /auth/me/avatar):
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/verify-cloudinary.ts
 *
 * Uploads a 1x1 JPEG to a deterministic test public id, fetches the returned
 * URL to prove it is publicly deliverable, then deletes the asset again.
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { StorageService } from '../../drivers/storage.service';

// Minimal valid 1x1 JPEG.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64',
);

const TEST_USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function main() {
  const config = new ConfigService({ ...process.env });
  const storage = new StorageService(config); // throws if creds are missing

  const file = {
    buffer: JPEG,
    size: JPEG.length,
    mimetype: 'image/jpeg',
    originalname: 'test.jpg',
  } as Express.Multer.File;

  const url = await storage.storeAvatar(TEST_USER_ID, file);
  console.log('storeAvatar ->', url);

  if (!/^https:\/\/res\.cloudinary\.com\//i.test(url)) {
    throw new Error(`Expected a public Cloudinary URL, got: ${url}`);
  }

  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  console.log(`fetch(${url}) -> ${res.status} ${type}`);
  await res.arrayBuffer();
  if (!res.ok || !type.startsWith('image/')) {
    throw new Error('Uploaded avatar is not publicly deliverable as an image');
  }

  // Cleanup: deterministic public id (folder from CLOUDINARY_FOLDER).
  const folder = (process.env.CLOUDINARY_FOLDER ?? 'vazhi').replace(/^\/+|\/+$/g, '');
  const publicId = `${folder}/avatars/${TEST_USER_ID.replace(/[^a-f0-9-]/gi, '')}`;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    console.log('cleaned up test asset:', publicId);
  } catch (err) {
    console.warn('cleanup failed (asset may already be gone):', (err as Error).message);
  }

  console.log('CLOUDINARY-VERIFY-OK');
}

main().catch((err) => {
  console.error('CLOUDINARY-VERIFY-FAIL:', err?.message ?? err);
  process.exit(1);
});
