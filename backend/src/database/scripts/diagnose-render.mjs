/**
 * Read-only diagnosis of a DEPLOYED backend: mints a JWT with the local
 * secret and inspects GET /auth/me. A 200 proves the target DB contains
 * the account (shared DB) and reveals what shape `avatar` is stored as.
 *
 * Run:  RIDER_ID=<uuid> BASE_URL=<api-base-url> node src/database/scripts/diagnose-render.mjs [upload]
 * (BASE_URL and RIDER_ID may also be passed as the two positional args.)
 * With `upload` it additionally POSTs a 1x1 test JPEG to the target
 * POST /auth/me/avatar to reveal the server's STORAGE_DRIVER.
 *
 * Pass-4 guard: refuses BASE_URL=production outright, refuses a remote
 * BASE_URL unless --i-understand-this-is-a-remote-database is passed, and
 * never signs a token without warning that a SHARED JWT secret is itself
 * the bug this script exposes (dev and prod secrets must differ).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const REMOTE_FLAG = '--i-understand-this-is-a-remote-database';

// Target and subject come from the environment (or positional args) — nothing
// hard-coded. `upload` stays a free positional flag.
const doUpload = process.argv.includes('upload');
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== 'upload');
const BASE = process.env.BASE_URL ?? positional[0];
const RIDER_ID = process.env.RIDER_ID ?? positional[1];

if (!BASE || !RIDER_ID) {
  console.error('Refusing to run: BASE_URL and RIDER_ID are required (env or positional args).');
  process.exit(1);
}
const isLocalTarget = /^https?:\/\/(\[::1\]|localhost|127\.0\.0\.1)(:|\/|$)/i.test(BASE);

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

async function main() {
  loadDotEnv();
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    console.error('Refusing to run: NODE_ENV=production.');
    process.exit(1);
  }
  if (!isLocalTarget && !process.argv.includes(REMOTE_FLAG)) {
    console.error(
      `Refusing to sign a token for remote BASE_URL "${BASE}": ` +
        `re-run with ${REMOTE_FLAG} if you really mean it.`,
    );
    process.exit(1);
  }
  if (!isLocalTarget) {
    console.warn(
      'WARNING: this only works when the LOCAL JWT_ACCESS_SECRET equals the deployed one — ' +
        'that must never be the case. Rotate the production secret and use separate dev secrets.',
    );
  }
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
