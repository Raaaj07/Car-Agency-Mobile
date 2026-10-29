# RUNBOOK — deploy, migrate, roll back, incident response

Names only for secrets: this file never contains values.

## 1. Deploy (backend, Render or any container host)

1. Merge to `main`; CI must be green (unit + fresh-DB integration + frontend).
2. Build the image from `backend/Dockerfile` (runs as the unprivileged `node` user).
3. Set/refresh env vars from `ADMIN.md` §Environment. Production refuses to boot when
   `OTP_DEV_MODE=true` or `PAYMENTS_DEV_MODE=true`, or when `DB_SYNCHRONIZE=true`.
4. Run migrations **once, manually** before starting the new image:

   ```bash
   cd backend && npm run migration:run
   ```

5. Deploy, then check `GET /health` → `{ status: "ok", postgres: "up", redis: "up" }`.
6. Smoke: send OTP → verify → book → (driver) accept → complete → payment screen.

## 2. Migrations

- Never automatic; never edit an already-applied migration.
- Add a new timestamped file under `backend/src/database/migrations/`.
- Fresh-DB safety is enforced by CI's `backend-integration` job (full chain on an empty PostGIS DB).
- Roll back one step with `npm run migration:revert` only if the migration is reversible and was
  just applied; otherwise roll forward with a new migration.

## 3. Rollback

1. Redeploy the previous image tag (schema is backward-compatible: migrations are additive).
2. If a migration must be undone, prefer a forward-fix migration over `revert` on live data.
3. Verify `/health` and one booking after rollback.

## 4. Incident playbooks

### Redis unreachable / realtime degraded

Symptoms: `/health` shows `redis: "down"`; live tracking stalls; offers stop arriving; logs:
`Redis connection lost — Socket.IO cross-instance broadcasts are retrying`.

1. Check the Redis host/port/password and TLS settings (`REDIS_URL` or `REDIS_HOST/PORT/PASSWORD/TLS`).
2. Restore Redis. The adapter reconnects automatically (`reconnecting` → `ready` in logs).
3. Ride state is still authoritative in Postgres: clients poll `GET /rides/:id` and
   `GET /rides/offers/pending`, so a reconnect recovers the screen.
4. If Redis stays down: restart instances one at a time — each falls back to the in-memory adapter
   at boot (single-instance realtime only).

### Payment mismatch / unsettled ride

Symptoms: `Razorpay webhook not settled` log line; `payment_mismatch` row in the admin audit log;
completed ride with `paymentStatus <> 'paid'` in the admin dashboard.

1. Compare the Razorpay order/payment amounts with the ride fare (never paste keys or payloads into chat).
2. If the charge is correct, resolve it in Admin → Rides → payment resolution (`paid`, with a note).
3. If not, mark `disputed` and follow up with the gateway; the rider is never auto-charged by us.

### Stuck ride (`requested` with no driver, or `matched` too long)

1. Admin → Overview surfaces stuck rides (oldest first).
2. Rider can tap Retry (`POST /rides/:id/rematch`); the search window auto-cancels with
   `no_drivers_available` after the configured attempts/time.
3. Admin can cancel with a reason (`POST /admin/rides/:id/cancel`), which frees the driver and timers.

### Suspected account takeover

1. Admin → Drivers/Users: suspend the account (closes sockets, blocks driver routes).
2. "Log out everywhere" revokes all refresh sessions and closes every socket for that user.
3. Rotate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` only as a last resort (logs everyone out).

### Secret leak

1. Treat any tracked `.env*`, keystore or token as compromised; rotate at the provider.
2. `git ls-files -- '*.jks' '*.env*'` must print nothing; the secret-guard workflow enforces it.
3. If an Android upload key leaked, regenerate it and re-upload to Play Console.

## 5. Health & monitoring checklist

- `/health`: Postgres + Redis round-trip (2 s timeouts).
- Watch: offer→accept rate, rides stuck in `requested`, webhook mismatches, socket handshake
  rejections, Redis reconnect events, OTP send failures, p95 latency.
- Sentry DSN (optional) is read from the backend env; never log tokens, phone numbers or payloads.
