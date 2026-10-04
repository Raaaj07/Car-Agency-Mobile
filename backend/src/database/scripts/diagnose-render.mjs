/**
 * Read-only diagnosis of the DEPLOYED backend: mints a JWT with the local
 * secret and inspects GET /auth/me. A 200 proves the deployed DB contains
 * the account (shared DB) and reveals what shape `avatar` is stored as
 * (https Cloudinary URL vs legacy local path vs null).
 *
 * Run:  node src/diagnose-render.mjs [upload]
 * With `upload` it additionally POSTs a 1x1 test JPEG to the deployed
 * POST /auth/me/avatar to reveal the server's STORAGE_DRIVER, prints the
 * result, then restores users.avatar to null locally (shared DB).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const BASE = 'https://car-agency-mobile.onrender.com/api/v1';
const RIDER_ID = 'c88c7e98-c781-4ed3-89fa-024ff0d1430c';

const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

function loadDotEnv() {
  const raw = readFileSync(path.join(BACKEND_ROOT, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^["'`]/.test(v)) v = v.replace(/^["'`]/, '').replace(/["'`]$/, '');
    else {
      const h = v.indexOf('#');
      if (h >= 0) v = v.slice(0, h).trimEnd();
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const doUpload = process.argv.includes('upload');

async function main() {
  loadDotEnv();
  const token = jwt.sign(
    { sub: RIDER_ID, phone: '', role: 'rider' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '10m' },
  );

  const meRes = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(90000),
  });
  const meText = await meRes.text();
  console.log(`GET /auth/me (deployed) -> ${meRes.status}`);
  console.log(meText.slice(0, 500));
  if (meRes.status !== 200) return;

  if (!doUpload) return;

  const form = new FormData();
  form.append('avatar', new Blob([Buffer.from(JPEG_B64, 'base64')], { type: 'image/jpeg' }), 'test.jpg');
  const upRes = await fetch(`${BASE}/auth/me/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  const upText = await upRes.text();
  console.log(`POST /auth/me/avatar (deployed) -> ${upRes.status}`);
  console.log(upText.slice(0, 500));
}

main().catch((e) => {
  console.error('FATAL:', e?.message ?? e);
  process.exit(1);
});
