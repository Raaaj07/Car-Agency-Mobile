/**
 * Boots the built backend on PORT=3100 and drives the real avatar pipeline:
 *   POST /auth/me/avatar (multipart, JWT) -> expect public Cloudinary URL
 *   GET  /auth/me                        -> avatar persisted
 *   GET  <avatar url>                    -> 200 image
 *   GET  /users/:id/avatar (no token)    -> must NOT be 401 (public route)
 *
 * Run:  node src/database/scripts/verify-avatar-e2e.mjs
 * Afterwards restore the test account:  avatar.ts <userId> clear
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const cloudinaryPkg = require('cloudinary');
const cloudinary = cloudinaryPkg.v2 ?? cloudinaryPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const PORT = process.env.E2E_PORT ?? '3100';
const BASE = `http://localhost:${PORT}/api/v1`;
const RIDER_ID = 'c88c7e98-c781-4ed3-89fa-024ff0d1430c';

// Minimal valid 1x1 JPEG.
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

function loadDotEnv() {
  const raw = readFileSync(path.join(BACKEND_ROOT, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^["'`]/.test(v)) {
      v = v.replace(/^["'`]/, '').replace(/["'`]$/, '');
    } else {
      // dotenv stops an unquoted value at the first '#' (inline comment).
      const hash = v.indexOf('#');
      if (hash >= 0) v = v.slice(0, hash).trimEnd();
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const log = [];
function say(...parts) {
  const line = parts.join(' ');
  log.push(line);
  console.log(line);
}

async function waitForServer(child, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try {
      const res = await fetch(`${BASE}/zzz-not-a-route`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 404) return; // routing up
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('server did not start in time');
}

async function main() {
  loadDotEnv();
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET missing from .env');
  const folder = (process.env.CLOUDINARY_FOLDER ?? 'vazhi').replace(/^\/+|\/+$/g, '');

  const child = spawn(process.execPath, ['dist/main'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  let avatarUrl = null;
  try {
    await waitForServer(child);
    say('server up on :' + PORT);

    const token = jwt.sign(
      { sub: RIDER_ID, phone: '', role: 'rider' },
      secret,
      { expiresIn: '10m' },
    );

    // 1. multipart upload through the real endpoint
    const form = new FormData();
    form.append('avatar', new Blob([JPEG_B64 ? Buffer.from(JPEG_B64, 'base64') : Buffer.alloc(0)], { type: 'image/jpeg' }), 'test.jpg');
    const upRes = await fetch(`${BASE}/auth/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const upBody = await upRes.json().catch(() => ({}));
    say(`POST /auth/me/avatar -> ${upRes.status} avatar=${upBody.avatar ?? JSON.stringify(upBody)}`);
    if (upRes.status !== 200) throw new Error(`upload failed: ${upRes.status}`);
    avatarUrl = upBody.avatar;
    if (!/^https:\/\/res\.cloudinary\.com\//i.test(avatarUrl)) {
      throw new Error(`expected Cloudinary URL (cloudinary configured), got: ${avatarUrl}`);
    }

    // 2. GET /auth/me reflects it
    const meRes = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const me = await meRes.json();
    say(`GET /auth/me -> ${meRes.status} avatar=${me.avatar}`);
    if (meRes.status !== 200 || me.avatar !== avatarUrl) throw new Error('avatar not persisted on /auth/me');

    // 3. the photo is publicly deliverable
    const imgRes = await fetch(avatarUrl, { signal: AbortSignal.timeout(30000) });
    const imgType = imgRes.headers.get('content-type') ?? '';
    await imgRes.arrayBuffer();
    say(`fetch(avatar) -> ${imgRes.status} ${imgType}`);
    if (!imgRes.status || imgRes.status !== 200 || !imgType.startsWith('image/')) {
      throw new Error('avatar URL not publicly deliverable');
    }

    // 4. legacy local-avatar endpoint must be reachable WITHOUT a token now
    const rawRes = await fetch(`${BASE}/users/${RIDER_ID}/avatar`, { signal: AbortSignal.timeout(15000) });
    say(`GET /users/:id/avatar (no token) -> ${rawRes.status}`);
    if (rawRes.status === 401) throw new Error('avatar endpoint still requires a JWT — RN <Image> can never load it');
    // 400 "Avatar not found" is expected: this account now holds a Cloudinary URL.

    say('AVATAR-E2E-OK');
  } catch (err) {
    console.error('AVATAR-E2E-FAIL:', err?.message ?? err);
    console.error('--- server log tail ---\n' + log.slice(-40).join(''));
    process.exitCode = 1;
  } finally {
    if (avatarUrl) {
      const m = avatarUrl.match(/\/upload\/(?:v\d+\/)?(.+?)$/);
      const publicId = m ? m[1].replace(/\.jpg$/, '') : `${folder}/avatars/${RIDER_ID}`;
      try {
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
          secure: true,
        });
        await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
        say('cleaned up cloudinary asset:', publicId);
      } catch (e) {
        say('cleanup warning:', e?.message ?? String(e));
      }
    }
    child.kill();
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message ?? e);
  process.exit(1);
});
