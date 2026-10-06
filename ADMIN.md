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

12 migrations total; all are applied on the dev machine. For a fresh checkout the
only post-pull migration is `1791300000000-AddPromosTables` (creates `promos` +
`promo_redemptions` and seeds `VAZHI20` with the original config copy — rider-visible
promo behaviour is unchanged after running it).

## Environment (names only)

- Backend: `ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `STORAGE_DRIVER` (`local`|`cloudinary`, needs `CLOUDINARY_*` for deploys), `CORS_ORIGIN`,
  `DB_SSL_REJECT_UNAUTHORIZED`, `OTP_DEV_MODE`, `PAYMENTS_DEV_MODE` (both **refuse to boot in production when `true`**),
  `TIMER_SWEEP_MS` (ride-offer/search timer sweep interval, default 5000), `PRNG_SEED` (deterministic dev seed).
- Frontend: `EXPO_PUBLIC_API_URL` (must end in `/api/v1`), plus the Google/Mapbox keys already in use.

## Owner security checklist (S-1)

- `*.jks` keystores and `.env*` files are gitignored (root + `frontend/.gitignore`) and **must never be shared**;
  a pre-commit hook (`.githooks/pre-commit`, enabled via `git config core.hooksPath .githooks`) and
  `.github/workflows/secret-guard.yml` both fail if `git ls-files '*.jks' '*.env*'` is ever non-empty.
  Manual check: `git ls-files -- '*.jks' '*.env*'` → must print nothing.
- If the project archive (with the three upload keystores) was ever shared: **rotate/regenerate the Android upload key** and rotate DB, Redis,
  JWT, MSG91, Razorpay and Cloudinary secrets. This pass never touched those files — rotation is owner-only.
- Before real users: set `OTP_DEV_MODE=false` and `PAYMENTS_DEV_MODE=false`, and move uploads to `STORAGE_DRIVER=cloudinary` (local disk dies on ephemeral hosts).

## Verification commands

```bash
cd backend  && npx tsc --noEmit && npx jest          # 128 tests / 12 suites
cd frontend && npx tsc --noEmit && npx eslint src    # 0 errors
```

## Known limitations (accepted)

- Payment + OTP run in dev modes until the owner flips them off (fail-closed in production).
- `D-4` background location heartbeat needs a new native build (`npx expo run:android|ios` or EAS) and background permission ("allow all the time") on the driver's device.
- CSV export is capped at 50 000 rows per request; ride-list phone privacy applies to the export too.
- Device/DB/Redis/payment-sandbox tests in the delivery report's "needs manual verification" list have not been run here.
