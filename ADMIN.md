# ADMIN.md — admin console & owner operations

Short ops guide for the Vazhi admin dashboard (Admin Dashboard Overhaul 2026-10-05,
follow-up pass 2026-10-06). Bug-by-bug status and history: `CHANGES.md` (changes)
and `AUDIT.md` (as-found baseline).

## Access

- Admins are bootstrapped from `ADMIN_PHONES` (backend env, comma-separated E.164 numbers).
  Sign-in with any listed phone → OTP → the app routes to the **Admin** console instead of the rider tabs.
- The console: **Overview** (live counts, recent activity feed from the audit log) →
  **Drivers** (application queue: pending/approved/suspended/rejected, detail, document viewer with pinch/pan zoom, approve/reject/suspend/reinstate) →
  **Rides** (filters by status/payment/date + search, detail with timeline/fare/payment trail + routed-distance outlier flag, cancel, mark paid/disputed) →
  **Account** (version, logout, **Promo codes**).
- **Promo codes** (Account → Promo codes): list every code with a live status pill
  (Active / Scheduled / Expired / Limit reached / Inactive), create/edit via a modal form
  (code, discount, card copy, validity window, redemption cap, first-ride-only, active toggle),
  activate/deactivate in one tap, delete with a confirm (redemption history survives via
  `promo_redemptions` SET NULL + denormalised code). Backed by `GET|POST /admin/promos`,
  `PATCH|DELETE /admin/promos/:id` (JWT + admin role; duplicate code → 409).
- Every admin action writes an `admin_audit_logs` row (action, target, reason, actor, timestamp), visible in Overview "Recent activity" and the driver detail "Review history".
  Actions: `approve`, `reject`, `suspend`, `reinstate`, `ride_cancel`, `payment_resolve`, `upi_update`.
- Owner extras: `GET /admin/users` (user management list — name/phone/email search, role filter,
  batched ride counts) and `GET /admin/rides/export.csv` (CSV export of the filtered rides list —
  same whitelist as the console list, phones never included, 50k row cap).

## Migrations (run once, manually — never automatic)

```bash
cd backend && npm run migration:run
```

16 migrations total. For a fresh checkout the newest are `1791500000000-AddUserEmailVerified`
(social sign-in no longer links accounts by raw email — the flag must be set by a verified
audience), `1791600000000-AddActiveRideUniqueIndex` (partial unique index
`UQ_rides_active_per_rider` — at most ONE active ride per rider, enforced by the database;
dedupes any pre-existing double-bookings first, then cancels the older ones as system) and
`1791400000000-AddRideOfferAndOtpColumns` (M-3 fix — see below). Run them on Render after
every pull that touches `backend/src/database/migrations/` — they are never automatic.

> **⚠ M-2 — fresh-database blocker (owner fix pending):** on a *brand-new*
> database `migration:run` fails at the legacy auto-generated
> `SyncSchemaDrift1790972060287` migration (`column ... already exists` — it
> re-adds columns the backdated `1700000000200/0300/0400` migrations already
> create). Dev works only because its history recorded that migration before
> those files existed. Existing migrations must not be edited in this pass, so:
> the integration suite detects the conflict and pre-marks the migration after
> proving it redundant, but **`npm run migration:run` on a truly fresh database
> still needs the owner to make that migration idempotent
> (`ADD ... IF NOT EXISTS`) or delete its redundant statements**, then verify on
> a throwaway database. Until then, new environments bootstrap via the test
> suite's documented repair or a copy of dev's schema.

## Environment (names only)

- Backend: `ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `STORAGE_DRIVER` (`local`|`cloudinary`, needs `CLOUDINARY_*` for deploys), `CORS_ORIGIN`,
  `DB_SSL_REJECT_UNAUTHORIZED` (same policy for the app AND `migration:run` — see `config/db-ssl.ts`),
  `OTP_DEV_MODE`, `PAYMENTS_DEV_MODE` (both **refuse to boot in production when `true`**),
  `OTP_LENGTH` (4–8, default 4 — the APK shipped 4-digit OTP entry; **flip to 6 once the
  updated app is out** and set `ADMIN_OTP_MIN_LENGTH`-style expectations for phone-based admin promotion, which always requires ≥ 6),
  `GOOGLE_WEB_CLIENT_ID` / `APPLE_CLIENT_ID` (social sign-in **audience** checks — required in
  production; the app refuses social sign-in with a 503 when unset, and Google/Apple tokens are
  rejected when their `aud` does not match),
  `TIMER_SWEEP_MS` (ride-offer/search timer sweep interval, default 5000), `PRNG_SEED` (deterministic dev seed),
  `TRUST_PROXY` (default `false`; set `true` **only** behind a reverse proxy so rate limiting sees real client IPs —
  never enable when the app port is directly reachable, or clients could spoof `X-Forwarded-For` to bypass throttles).
- Frontend: `EXPO_PUBLIC_API_URL` (must end in `/api/v1`), `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
  (Google sign-in client id), plus the Google Places/Maps and Mapbox keys — all `EXPO_PUBLIC_*`
  values compile INTO the JS bundle and are extractable from any APK: restrict them in their
  cloud consoles (API restrictions, quota/billing alerts).

## Owner security checklist (S-1)

- `*.jks` keystores and `.env*` files are gitignored (root + `frontend/.gitignore`) and **must never be shared**;
  a pre-commit hook (`.githooks/pre-commit`, enabled via `git config core.hooksPath .githooks`) and
  `.github/workflows/secret-guard.yml` both fail if `git ls-files '*.jks' '*.env*'` is ever non-empty.
  Manual check: `git ls-files -- '*.jks' '*.env*'` → must print nothing.
- If the project archive (with the three upload keystores) was ever shared: **rotate/regenerate the Android upload key** and rotate DB, Redis,
  JWT, MSG91, Razorpay and Cloudinary secrets. This pass never touched those files — rotation is owner-only.
- Before real users: set `OTP_DEV_MODE=false` and `PAYMENTS_DEV_MODE=false`, and move uploads to `STORAGE_DRIVER=cloudinary` (local disk dies on ephemeral hosts).

## Security hardening (2026-10-09)

- **Default-deny auth**: `JwtAuthGuard` is a global `APP_GUARD` (registered after `ThrottlerGuard`).
  Every route requires a bearer token unless its handler/controller is explicitly `@Public()`.
  The complete public surface: `POST /auth/otp/send`, `POST /auth/otp/verify`, `POST /auth/refresh`,
  `POST /auth/google`, `POST /auth/apple`, `GET /users/:id/avatar`, `GET /places/photo/*`.
  A new controller added without a guard is now **401, not open**. `RolesGuard` /
  `ApprovedDriverGuard` keep running per-route on top of it.
- **Throttles**: global 300 req/min; OTP send 10/10min and verify 30/5min per IP (on top of
  per-phone caps + the OTP failure lockout — 10 wrong codes in 60 min locks verification);
  `refresh`/`google`/`apple` 30/5min; both public photo routes 120/min/IP
  (each cache miss is a billable server-side Google/Wikimedia fetch, and the proxy cache is
  LRU-bounded: 400 entries / 32 MB).
  **Authenticated traffic is keyed PER USER** (`user:<id>` from the verified bearer token —
  `UserKeyedThrottlerGuard`), falling back to per-IP only for anonymous/forged tokens, so
  rotating IPs cannot refresh a bucket and CGNAT/proxy users cannot starve each other.
  IP-keyed limits are still only correct behind a proxy with `TRUST_PROXY=true` (see Environment).
- **Dependencies**: `npm audit --omit=dev` went 13 (3 high) → 5 via npm `overrides`
  (multer 2.4.0, qs 6.16.0, body-parser 1.20.8, lodash 4.18.1, file-type 21.x, uuid 11.1.1).
  The 5 remaining are all the one `@nestjs/core` advisory fixed only in **Nest 12** (major
  upgrade — owner decision) plus its transitive spread; re-check with `npm audit --omit=dev`.
- **Container**: `backend/.dockerignore` keeps `.env*`, keystores and keys out of the build
  context; the runtime image installs with `npm ci` and runs as the unprivileged `node` user.
  Rebuild + smoke after pulling (`docker compose build`) — Docker is absent on the dev machine,
  so these changes were verified by inspection only.

## Verification commands

```bash
cd backend  && npx tsc --noEmit && npx jest          # unit: 209 tests / 20 suites (no DB needed)
cd frontend && npx tsc --noEmit && npx eslint src    # 0 errors
```

Opt-in integration suite (real Postgres, 11 tests / 3 suites — promos FK/atomicity,
admin users+CSV with real SQL, entity↔schema fidelity):

```bash
cd backend
docker compose -f docker-compose.test.yml up -d --wait   # throwaway Postgres :5433 + Redis :6380
INTEGRATION=1 npm run test:integration                   # PowerShell: $env:INTEGRATION='1'
docker compose -f docker-compose.test.yml down -v        # reset all state
```

No Docker needed: without `TEST_DB_*` overrides the suite reuses `.env` credentials
against the local server and creates its own `vazhi_test` database (never dev's).

## Known limitations (accepted)

- Payment + OTP run in dev modes until the owner flips them off (fail-closed in production).
- Fresh-DB `migration:run` blocker **M-2** (see Migrations above): the chain only runs end-to-end on
  dev until the owner makes the legacy `SyncSchemaDrift` migration idempotent.
- `D-4` background location heartbeat needs a new native build (`npx expo run:android|ios` or EAS) and background permission ("allow all the time") on the driver's device.
- CSV export is capped at 50 000 rows per request; ride-list phone privacy applies to the export too.
- Device/DB/Redis/payment-sandbox tests in the delivery report's "needs manual verification" list have not been run here.
- **Multi-device sessions**: refresh tokens are single-use (rotation on every refresh), but there is
  no server-side session registry — logging in on a second device with the same phone does NOT
  revoke the first device's tokens, and logout on one device does not invalidate the other's
  refresh token (only that device's current token dies when it is presented). A "revoke all
  sessions" / session-family table is the known follow-up if account-takeover response needs it.
- Security-hardening pass 2 residuals (2026-10-09, branch `security-hardening`): `npm audit` still
  reports 5 backend moderates (all on the Nest 12 upgrade chain, `fixAvailable` wants a major bump)
  and 16 frontend build-tool highs with `fixAvailable: false` (Expo/Metro toolchain — upgrading is
  Expo's job, not a pin away); the global rate limiter sits before the router so 400s/404s consume
  buckets; `docker-compose.yml`'s `migration:run` service is missing `ts-node` (use
  `npm run migration:run` on the host instead); there is still no root `README.md`.
