# ADMIN.md — admin console & owner operations

Short ops guide for the Vazhi admin dashboard (Admin Dashboard Overhaul, 2026-10-05).
Bug-by-bug status and history: `CHANGES.md` (changes) and `AUDIT.md` (as-found baseline).

## Access

- Admins are bootstrapped from `ADMIN_PHONES` (backend env, comma-separated E.164 numbers).
  Sign-in with any listed phone → OTP → the app routes to the **Admin** console instead of the rider tabs.
- The console: **Overview** (live counts, recent activity) → **Drivers** (application queue: pending/approved/suspended/rejected, detail, document viewer, approve/reject/suspend/reinstate) →
  **Rides** (filters by status/payment/date + search, detail with timeline/fare/payment trail, cancel, mark paid/disputed) → **Account** (version, logout).
- Every admin action writes an `admin_audit_logs` row (action, target, reason, actor, timestamp), visible in Overview "Recent activity" and the driver detail "Review history".
  Actions: `approve`, `reject`, `suspend`, `reinstate`, `ride_cancel`, `payment_resolve`, `upi_update`.

## Migrations (run once, manually — never automatic)

```bash
cd backend && npm run migration:run
```

Pending: `1791200000000-AdminSafetyAndPaymentTracking`, `1791200001000-AdminAuditLogs`,
`1791200002000-AddDriverUpiVpaAndDropVerificationColumns` (adds `drivers.upiVpa`, drops legacy `verificationStatus`/`verificationNote`).

## Environment (names only)

- Backend: `ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `STORAGE_DRIVER` (`local`|`cloudinary`, needs `CLOUDINARY_*` for deploys), `CORS_ORIGIN`,
  `DB_SSL_REJECT_UNAUTHORIZED`, `OTP_DEV_MODE`, `PAYMENTS_DEV_MODE` (both **refuse to boot in production when `true`**).
- Frontend: `EXPO_PUBLIC_API_URL` (must end in `/api/v1`), plus the Google/Mapbox keys already in use.

## Owner security checklist (S-1)

- `*.jks` keystores and `.env*` files are gitignored (root + `frontend/.gitignore`) and **must never be shared**;
  `.github/workflows/secret-guard.yml` fails CI if `git ls-files '*.jks' '*.env*'` is ever non-empty.
  Manual check: `git ls-files -- '*.jks' '*.env*'` → must print nothing.
- If the project archive (with the three upload keystores) was ever shared: **rotate/regenerate the Android upload key** and rotate DB, Redis,
  JWT, MSG91, Razorpay and Cloudinary secrets. This pass never touched those files — rotation is owner-only.
- Before real users: set `OTP_DEV_MODE=false` and `PAYMENTS_DEV_MODE=false`, and move uploads to `STORAGE_DRIVER=cloudinary` (local disk dies on ephemeral hosts).

## Verification commands

```bash
cd backend  && npx tsc --noEmit && npm run build && npx jest        # 61 tests / 7 suites
cd frontend && npx tsc --noEmit && npx expo lint                    # 0 errors / 0 warnings
```

## Known limitations (accepted)

- Offer timers are in-memory (single instance only) — move to BullMQ/Redis expiry before scaling out (`rides.service.ts` comment, R-5).
- Payment + OTP run in dev modes until the owner flips them off (fail-closed in production).
- `D-4` background location heartbeat needs a new native build (`npx expo run:android|ios` or EAS) and background permission ("allow all the time") on the driver's device.
- Device/DB/Redis/payment-sandbox tests in the delivery report's "needs manual verification" list have not been run here.
