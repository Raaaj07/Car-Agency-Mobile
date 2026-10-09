# CHANGES.md â€” one login, driver applications, admin review, mode switching

Phases 1â€“6 implemented in one pass (no approval gates per owner request).
Deviations from the prompt are noted inline with justification.

---

## Admin Dashboard Overhaul + Bug Fix Pass (2026-10-05)

Second pass, seven phases, one commit per phase (`d7e5d14` â†’ `6fd5de0` â†’ `76307d2` â†’ `91e5bd9` â†’ `ec479c1` â†’ cleanup commit).
Full bug list with per-ID status lives in the final delivery report; summary:

- **Phase 1 (P0 safety/money)** â€” `A-1` (suspend-vs-active-ride 409 + force-cancel), `A-2` (approve idempotence/review history), `A-3` (reject reason 5â€“300 + re-apply),
  `R-1` (no-drivers-found timeout), `R-2` (cancel ownership + timer survives), `R-3` (booking guards kept honest), `P-1` (payment idempotency + amount match),
  `P-2` (payment ownership), `AU-1/AU-2` (OTP/payments dev-mode fail-closed, prod boot refusal), `T-1` (first backend tests), `A-*` audit-era gaps.
  Migration `1791200000000-AdminSafetyAndPaymentTracking.ts`.
- **Phase 2 (admin backend)** â€” audit table + write-through (`approve/reject/suspend/reinstate/ride_cancel/payment_resolve/upi_update`), overview stats, driver/ride lists+detail+actions,
  `admins` socket room + `admin:application:new`, IST helpers (`R-6`). Migration `1791200001000-AdminAuditLogs.ts`.
- **Phase 3â€“4 (admin frontend)** â€” typed `api/admin.ts`, IST/INR formatters, hooks, 16 `components/admin/*`, admin-mode `BottomTabBar`, new 4-tab `AdminNavigator`
  (Overview â†’ Drivers(+detail) â†’ Rides(+detail) â†’ Account); old `AdminTabNavigator`/`AdminApplications*` deleted. `A-11` live badge + toast, `A-14` admin socket role, `M-1`.
- **Phase 5 (remaining P1)** â€” `R-4` all ride transitions in `withRideLock` (pessimistic + txn; OTP counters commit before the throw), `R-5` documented single-instance timers,
  `R-7` distance clamp 1.5Ã— + `distanceOutlier` flag in admin ride detail, `D-1` payee `upiVpa` on driver profile (validated, audited, shown in admin detail; QR reads profile first),
  `D-2` deprecated `verificationStatus` columns dropped, `D-3` geo heartbeat ZSET + 90 s ghost sweep + Redis `quit()` on shutdown, `D-4` background location heartbeat
  (`expo-task-manager` + foreground service; requires a new native build), `AU-3` socket reads the live token (auth callback + refresh nudge), `PR-1` promo copy aligned to `VAZHI20` (â‚¹20).
  Migration `1791200002000-AddDriverUpiVpaAndDropVerificationColumns.ts`.
- **Phase 6 (cleanup/docs)** â€” frontend lint **0 errors / 0 warnings** (was 44/47): all `react-hooks/refs` + `set-state-in-effect` fixed without behavior change,
  unused imports removed, duplicate imports merged, exhaustive-deps reviewed (handler-ref patterns for `onDecline`/`onGoogleToken`; store-object deps elsewhere),
  legacy `authStore.role` + `types.ts` `RiderTabParamList`/`DriverTabParamList`/`RiderMain`/`DriverMain` removed, `S-1` guard added
  (root `.gitignore` hardening + `.github/workflows/secret-guard.yml`), `ADMIN.md` created, `AUDIT.md` status banner added.

**Migrations pending for the owner (never run automatically):**

```bash
cd backend && npm run migration:run   # 1791200000000, 1791200001000, 1791200002000
```

Verification: backend `npx tsc --noEmit` + `npm run build` + `npx jest` (61 tests / 7 suites) PASS;
frontend `npx tsc --noEmit` PASS, `npx expo lint` 0 errors / 0 warnings.

---

## What changed (by area)

### Backend â€” auth foundation (Phase 1)
- Changed: `src/auth/entities/user.entity.ts` (`profileComplete`, `refreshTokenHash`, role `rider|driver|admin`), `src/auth/auth.service.ts` (rewrite: no client roles, `email_verified` gate on Google link, `isNewUser` after link, rotating refresh with SHA-256 hash + revocation, `logout`, `me` returns `driverStatus`), `src/auth/auth.controller.ts` (`POST /auth/logout`, role-less social DTOs), `src/auth/auth.module.ts` (DriverEntity repo, `OTP_DEV_MODE` default `false`), `src/auth/tokens.service.ts` (admin-ready role), `src/auth/strategies/jwt.strategy.ts` (DB lookup, rejects inactive), `src/auth/dto/{verify-otp,social-signin,update-me}.dto.ts` (role removed; avatar allowed), `src/common/frontend-contracts.ts` + `toFrontendUser()` (now `id/role/profileComplete/driverStatus`, field-for-field), `src/common/guards/roles.guard.ts` (admin), `src/payments/{payments.module,payments.controller}.ts` (dev default `false`; any-authed + ownership in service).
- Added: migration `1700000000300-AddUserProfileComplete.ts` (columns + backfill `profileComplete=true` where name not `New %`).

### Backend â€” driver applications (Phase 2)
- Decision (one line): extended the `drivers` table instead of a new `driver_applications` table â€” one profile per user, so application state on the same row avoids join/sync bugs.
- Changed: `src/drivers/entities/driver.entity.ts` (`status pending|approved|rejected|suspended`, `rejectionReason`, `reviewedByUserId/At`, `submittedAt`, `licenseImagePath/rcImagePath/vehiclePhotoPath`; `verificationStatus` kept as legacy mirror), `src/drivers/drivers.service.ts` (`registerOrUpdate` now yields `pending`, new `applyApplication`/`getApplication`, `setStatus` requires `approved`), `src/drivers/drivers.controller.ts` (`POST /drivers/apply` multipart + `GET /drivers/application`; `status`/`location` now `ApprovedDriverGuard`), `src/rides/rides.controller.ts` (create/review/payments open to any authed user; driver routes use `ApprovedDriverGuard`), `src/rides/rides.service.ts` (no double-booking, online drivers can't book, self-match exclusion kept), `src/payments/payments.controller.ts`.
- Added: migration `1700000000400-AddDriverApplicationLifecycle.ts` (columns + backfill `status` from `verificationStatus`, existing drivers â†’ `approved`), `src/drivers/storage.service.ts` (local disk `backend/uploads/`, JPEG/PNG/PDF magic-bytes check, 5 MB cap, UUID names), `src/drivers/guards/approved-driver.guard.ts` (DB check, never JWT role), `src/drivers/dto/apply-driver.dto.ts`, `@types/multer` dev dep.

### Backend â€” admin (Phase 3)
- Added: `src/admin/{admin.module,admin.controller,admin.service}.ts`, `src/admin/dto/{list-applications-query,review-application}.dto.ts`. Routes: `GET /admin/driver-applications?status=&page=&limit=`, `GET /:id`, `POST /:id/approve` (idempotent), `POST /:id/reject` (reason 5â€“300, idempotent), `POST /admin/drivers/:id/suspend` (idempotent, forces offline + geo removal + `driver:status` socket push), `GET /admin/files/:applicationId/:kind` (base64 JSON; `?raw=1` bytes). First admins come only from `ADMIN_PHONES` (bootstrap promotion). `RidesGateway.emitDriverStatus()` added; `RidesModule` now exports the gateway.
- Changed: `src/app.module.ts` (AdminModule), `src/config/env.validation.ts` (`ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`).

### Backend â€” remaining hardening (Phase 6)
- `src/rides/gateway/rides.gateway.ts`: `ride:join` membership-verified (rider or assigned driver only); `driver:location` requires approved status + ride ownership (B9/B11); CORS from `CORS_ORIGIN` (no `*` in prod); `?token=` query support removed.
- `src/rides/rides.service.ts`: `accept()` uses transaction + pessimistic write lock, timer cleared only after commit; `decline()` validates before clearing timer; `complete()` clamps driver distance (â‰¤3Ã— estimate, â‰¤500 km); `submitReview()` rejects second reviews.
- `src/config/typeorm.datasource.ts` + `app.module.ts`: `DB_SSL_REJECT_UNAUTHORIZED`, prod `synchronize=true` refusal (also in `validateEnv` with `OTP_DEV_MODE`/`PAYMENTS_DEV_MODE` prod refusal). `src/main.ts`: shutdown hooks, numeric port parse.
- `src/drivers/geo.service.ts`: GEOSEARCH failures now logged (was silent). `src/database/seeds/seed.ts`: refuses to run in production.

### Frontend â€” auth + navigation (Phase 1, 3, 4)
- Changed: `src/store/authStore.ts` (server-truth user, `activeMode`, `hydrated`, expo-secure-store persistence, boot `restoreSession`, server-revoking logout), `src/api/auth.ts` (no role args; `me`/`logout`), `src/navigation/OnboardingNavigator.tsx` (sign-in only; no intra-stack CompleteProfile nav), `src/navigation/types.ts` (no RoleSelection/CompleteProfile in onboarding; `Main`, `Admin`, `BecomeDriver`, `AdminTabParamList`), `src/navigation/AppNavigator.tsx` (splash â†’ Onboarding | CompleteProfile (`profileComplete===false`) | Admin (`role==='admin'`) | Main), `src/screens/onboarding/CompleteProfileScreen.tsx` (name-only), `AGENTS.md` (React Navigation section rewritten per rule 1).
- Added: `src/lib/tokenManager.ts` (cycle-free token hub), `src/api/admin.ts`, `src/navigation/AdminTabNavigator.tsx`, `src/screens/admin/{AdminApplicationsScreen,AdminApplicationDetailScreen,AdminDriversScreen}.tsx` (filter chips, pull-to-refresh, pagination, base64 docs, approve/reject-with-reason confirm dialogs, suspend).
- Changed (Phase 4): `src/api/drivers.ts` (`apply` FormData + progress, `application()`), `src/screens/rider/ProfileScreen.tsx` (5-state Driver section: none/pending/rejected/approved/suspended; avatar upload; switch-to-driver with socket reconnect), `src/screens/driver/BecomeDriverScreen.tsx` (multipart apply, progress %, plain size/type errors), `src/screens/driver/DriverDashboardScreen.tsx` (register banner deleted; pending card; Switch-to-Rider with offline-first + trip-block + heartbeat stop + socket reconnect), `src/navigation/MainTabNavigator.tsx` (`driver:status` listener + foreground `/auth/me` refresh force Rider mode), `src/components/primitives/DocumentUploader.tsx` + avatar picker (lazy `expo-image-picker`, Expo-Go-safe alert).
- Added deps: `expo-secure-store`, `expo-image-picker` (both via `npx expo install`). `app.json`: camera/photo permission strings + image-picker plugin.
- Deviation: kept the unified 4-tab `Main` shell instead of splitting back into `RiderMain`/`DriverMain` â€” one login with tab-level mode buttons satisfies "switch between modes" with less nav-state loss; `activeMode` is persisted and honored by Profile/Driver screens.

### Rider cleanup (Phase 5)
- Grep `driver|online|offline|register` over `screens/rider` + `RiderTabNavigator`/`RiderHomeStackNavigator`: remaining hits are legitimate trip context ("Searching for your driver", assigned-driver cards, `driver_en_route` status keys, "Pay driver directly") plus the required Â§3.6 Profile CTA and the Trips Booked/Driven toggle. No "Complete your driver registration", no `registerBanner`, no online/offline `Switch`, no `AccountTab`/`DriverMain` links from rider screens. `DriverDashboard` register banner deleted (replaced by status cards). Legacy `DriverTabNavigator`/`DriverAccountScreen`/`RoleSelectionScreen` remain as dead code (not in any navigator).

## Migrations to run

```bash
cd backend
npm run migration:run   # applies 0300 (profileComplete/refreshTokenHash) + 0400 (application lifecycle)
```

`uploads/` directory is created on first upload; it is git-ignored.

## Environment variables to add (names only)

`ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `DB_SSL_REJECT_UNAUTHORIZED`, `CORS_ORIGIN` (now enforced on HTTP + gateway). Production boot fails with `OTP_DEV_MODE=true`, `PAYMENTS_DEV_MODE=true`, or `DB_SYNCHRONIZE=true`.

Frontend (optional): `EXPO_PUBLIC_GOOGLE_PLACE` (alias `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`) â€” Google Places API (New) key used for real place photos on the home place-cards; `EXPO_PUBLIC_GOOGLE_MAPS_KEY` â€” Google *Maps Static API* imagery. Without a Google key, all place images fall back to Mapbox Static Images via the existing `EXPO_PUBLIC_MAPBOX_TOKEN`.

## Manual test script (from Â§9) â€” status

1. New phone OTP â†’ name â†’ Rider home; restart â†’ still signed in. NOT RUN (needs device; code paths: `restoreSession` + profile gate).
2. Profile shows Become a driver; rider screens free of driver controls. VERIFIED via grep (see Phase 5).
3. Apply with images â†’ Under review; driver endpoints 403. CODE-VERIFIED (`ApprovedDriverGuard`); live 403 NOT RUN.
4. Admin rejects with reason â†’ user sees reason, can re-apply. CODE-VERIFIED; live NOT RUN.
5. Re-apply â†’ approve â†’ Switch to Driver mode appears. CODE-VERIFIED; live NOT RUN.
6. Driver online â†’ rider books â†’ offer â†’ accept â†’ OTP â†’ complete â†’ earnings. Pre-existing flow preserved; live two-device NOT RUN.
7. Switch to Rider while online â†’ auto-offline; on trip â†’ blocked. CODE-VERIFIED (`switchToRider`); live NOT RUN.
8. Suspend while online â†’ app drops to Rider, vanishes from nearby. CODE-VERIFIED (`forceOffline` + `driver:status` + listener); live NOT RUN.
9. Idle 20 min â†’ next action works (refresh rotation). CODE-VERIFIED (rotation + interceptor); live wait NOT RUN.
10. User A cannot join B's ride room. CODE-VERIFIED (membership check); live socket test NOT RUN.

## Checks run

- `cd backend && npm run build` â€” PASS. `npx tsc --noEmit` (both) â€” PASS.
- `cd frontend && npx expo lint` â€” 28 pre-existing errors (Animated refs, set-state-in-effect in untouched primitives/screens); zero new errors from Phase 1â€“4 files beyond that pattern.
- `npx expo-doctor` â€” 20/21; only failure is expo `57.0.25` vs `~57.0.26` patch (left alone per no-upgrade rule).
- Backend was not running in this environment, so curl status codes could not be captured â€” endpoints are compile-verified only.

## Risks / unverified

- No live two-device or 20-minute idle test (see script above).
- In-memory offer timers remain single-instance; `decline`/`cancel` races narrowed but only `accept` holds a pessimistic lock.
- Local-disk uploads vanish on ephemeral hosts â€” S3/R2 swap needed before production.
- `users.role` still admits legacy `driver` values in DB; new code treats approval status as truth, but a future migration should normalize to `rider|admin`.
- Lint errors predate this work and were intentionally left untouched (out of scope).

## Review round â€” OTP display, mode switching, interactive pickup map

Changed (frontend only, 4 files):

- `src/screens/onboarding/OTPVerificationScreen.tsx` â€” dev OTP box gated on the server-provided `developmentOtp` presence instead of `__DEV__` (release bundles have `__DEV__===false`, so the box never showed in release builds); tap the box to auto-fill. Backend chain unchanged and already correct (`OTP_DEV_MODE=true`, non-prod boot, `DevSmsProvider` logs `[DEV OTP]`).
- `src/screens/rider/ProfileScreen.tsx` â€” driver account mode switch: the Profile tab (same screen in both modes) previously showed "Switch to Driver mode" even while already in driver mode; pressing it no-op'd the mode but bounced the socket and wiped ride state. Now shows "Switch to Rider mode" in driver mode, takes an online driver offline first (blocks on failure so no ghost-online driver remains), and both switch directions block while a trip is active (`matched|driver_en_route|in_progress`).
- `src/components/primitives/RealMapView.tsx` â€” interactive pickup pointing: `onRegionDidChange` + `properties.isUserInteraction` (gesture settles only; Android verified, iOS best-effort) calls new `onPickupPointed` with the map centre (`visibleBounds` midpoint fallback), debounced 150 ms. Camera centre frozen after mount (native `stop` re-applies on every prop-identity change â€” the old inline array snapped back to zoom 14 on each re-render); pickup re-centring now arrival-only with a last-target key so pointing/focus never re-runs an identical fly; `mapReady` gate via `onDidFinishLoadingMap`.
- `src/screens/rider/HomeDashboardScreen.tsx` â€” map is now interactive (removed `interactive={false}`): pan/pinch/tap sets the pickup (reverse-geocoded, newest gesture wins via sequence counter, initial GPS fix no longer overwrites a pointed pickup). Gesture routing: ScrollView `box-none`, map-area spacer `none`, header `box-none` so map drags and sheet scroll no longer fight. Morph/annotation rows `box-none` (taps no longer fall through to the map and teleport the pickup); white address bar is tappable â†’ search. Morph bar now lands at `insets.top + 8` (same spot as the pinned sticky pill â€” seamless crossfade, keeps the bar clear of the green location dot at map centre when focused).

Checks: `cd backend && npm run build` PASS; `cd frontend && npx tsc --noEmit` PASS; eslint on the 4 changed files = Home/OTP clean, RealMapView + ProfileScreen exactly at the pre-existing HEAD baseline (2 exhaustive-deps warnings; 1 `loadApp()` set-state-in-effect error + `radii` warning that exist at HEAD too). NOT RUN on device: map pointing, focus fly, sheet scroll feel, mode switching, OTP box in a fresh release build (rebuild `npx expo run:android --variant release` required â€” release embeds JS at build time).

## B15 secrets warning

`backend/.env`, `frontend/.env`, and three `.jks` keystores exist in the working folder (gitignored, contents never printed or modified here). If this folder was ever shared, rotate DB, Redis, JWT, MSG91, and Razorpay secrets, and revoke/reissue the upload keystores.

---

## Follow-up pass (11 tasks, 2026-10-06)

Built on top of Phases 1â€“6 (`d7e5d14` â†’ `bb632aa`). One commit per task group, never pushed.

### Status table

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 1 | S-1 secrets guard (pre-commit hook + CI workflow + `.env.example` names + `*.keystore` ignore) | **Done** | `66d9cc0` | `git config core.hooksPath .githooks`; hook rejects tracked `*.jks`/`.env*` |
| 2 | Overview activity feed from `GET /admin/audit` (`targetName` on backend) | **Done** | `8afcc44` | Overview "Recent activity" = audit rows, batched Driver/Ride name lookups, no phones |
| 3 | Document viewer pinch/pan/double-tap zoom | **Done** | `7429bbf` | RN `Animated` + RNGH 2.32 `Gesture.*`, scale clamped 1â€“4, no new libs |
| 4 | Routed distance everywhere (`RouteDistanceService`, Mapbox + haversineÃ—1.3 fallback) | **Done** | `01a3e51` | Completion clamp `min(max(estimateÃ—1.25, 2), 500)`; outlier flag at `recorded > routedÃ—1.5`; +9 tests |
| 5 | Redis-backed ride timers (`ride:timers` zset) | **Done** | `a37d010` | `TIMER_SWEEP_MS` (default 5000), atomic `zrem` claim, startup sweep, idempotent fires â€” replaces in-memory single-instance timers; +4 tests |
| 6 | Geo cleanup (heartbeat key `driver:lastseen`, 30 s sweep, Postgres offline) | **Done** | `ce129b1` | Sweep forces stale drivers offline in Postgres too; `FakeRedis` extended; +6 tests |
| 7 | Deterministic idempotent seed | **Done** | `d9e57c2` | `mulberry32(PRNG_SEED + i)` plans, never touches existing rows, admins ensured from `ADMIN_PHONES`, drivers seeded `approved` with pinned Redis geo; smoke-tested live (run 1: 40 created, run 2: 0); +10 tests |
| 8 | PR-1 promos: `promos` + `promo_redemptions` tables, admin CRUD, `AdminPromosScreen` | **Done** | `346e0b3` | Migration seeds `VAZHI20` with the old config copy; async `discountFor`; redemption recorded inside the completion ride-lock tx; 409 on dup code; SET NULL keeps history; `PROMOS_CONFIG` deleted; +24 tests |
| 9 | Admin extras: `GET /admin/users` + `GET /admin/rides/export.csv` | **Done** | `154c597` | Users: escaped ILIKE search (name/phone/email) + role filter + batched ride counts. CSV: shared filter whitelist, BOM/CRLF + formula-injection guard, no phones, 50k cap, route declared before `rides/:id`; +13 tests + live boot smoke test |
| 10 | Docs: `ADMIN.md`, `AUDIT.md`, `CHANGES.md` status table, `AGENTS.md`, backend README tests | **Done** | (this commit) | Refreshed to current state; stale "in-memory timers" limitation removed |
| 11 | Opt-in integration suite + `docker-compose.test.yml` | **Done** | (this commit) | 3 specs / 11 tests behind `INTEGRATION=1` + `jest.integration.config.js` (default `jest` stays unit-only, 128/12); double gate (config ignore + runtime check); throws away only `vazhi_test` (never dev); found + handled M-2/M-3 below |

### New findings (surfaced by the Task 11 suite)

| ID | Severity | Status | Detail |
|----|----------|--------|--------|
| **M-2** | High (blocks fresh deploys) | **Owner fix pending â€” test workaround in place** | The legacy auto-generated `SyncSchemaDrift1790972060287` migration re-`ADD`s columns the backdated `1700000000200/0300/0400` migrations already create (`IF NOT EXISTS`), so `migration:run` fails with `column ... already exists` on **every fresh database** â€” dev only survives because its history recorded it before those files were backdated in. Editing existing migrations is forbidden in this pass, so `src/integration/db-helpers.ts` detects the conflict, **proves redundancy** (all 18 columns + `drivers.rating` default), pre-marks it executed, re-runs the chain, and mirrors its final statement (avatar comment) so fresh â‰¡ dev. **Owner fix:** make that migration idempotent (`ADD ... IF NOT EXISTS`) or delete its redundant statements, then verify `migration:run` on a throwaway database. Until fixed, a brand-new *production* database cannot bootstrap via `migration:run` alone. |
| **M-3** | High (broke fresh INSERTs) | **Fixed â€” new migration `1791400000000-AddRideOfferAndOtpColumns`** | `rides.offeredAt`, `offerExpiresAt`, `declinedDriverIds`, `otpAttempts`, `otpLockedUntil` existed only on dev via `DB_SYNCHRONIZE=true` drift; no migration ever created them, so a fresh DB failed every ride INSERT (offer timers, declined-driver tracking, OTP lockout). Fixed additively (new migration, `IF NOT EXISTS` â€” no-op on dev; applied live: dev now at 13 migrations). Guarded forever by the new `schema.integration.spec.ts`, which diffs **every** entity column against the migrated schema. |

### What changed (high level)

- **Backend**: secrets guard; `targetName` in audit rows; `RouteDistanceService`; Redis `ride:timers`;
  `driver:lastseen` zset + Postgres-forcing sweep; idempotent `seed-data.ts`; promos tables/entities/
  DB-backed `PromosService`/`AdminPromosController`; `AdminService.listUsers` + `exportRidesCsv` with shared
  `ridesFilterQb` and `csv.ts` helpers; spec mocks updated for async `discountFor`.
- **Frontend**: document zoom; `AdminPromosScreen` + Account stack (`AdminAccountStackParamList`), "Promo codes"
  row on the Account screen, admin promo API functions.
- **Repo**: `.githooks/pre-commit`, `.github/workflows/secret-guard.yml`, `.env.example` files (names only).

### Verification (this pass)

- Backend: `npx tsc --noEmit` 0 errors; `npx jest` **128 tests / 12 suites** green; `npx eslint src` 0 errors (1 pre-existing warning `razorpay-payment.provider.ts:45`).
- Integration (opt-in): `INTEGRATION=1 npm run test:integration` **11 tests / 3 suites** green â€” three consecutive ways: already-migrated re-run, full fresh-database run (`CREATE DATABASE` â†’ chain â†’ M-2 repair), and a second fresh DB via `TEST_DB_DATABASE` override (then dropped).
- Frontend: `npx tsc --noEmit` 0 errors; `npx eslint src` 0 errors / 0 warnings.
- Live: `npm run migration:run` (AddPromosTables + AddRideOfferAndOtpColumns executed â€” dev at 13 migrations, `VAZHI20` row verified); `npm run seed` twice (idempotent);
  backend booted â†’ both new admin routes mapped and answer 401 unauthenticated, `export.csv` precedes `rides/:id` in the route map.
- Not verifiable here: Docker Desktop (absent â€” `docker-compose.test.yml` untested end-to-end; local Postgres used instead), device UI (zoom gestures, promo screen on handset), real Mapbox/MSG91/Razorpay calls, multi-instance Redis sweep under load â€” see delivery report checklist.

---

## Security hardening pass (2026-10-09)

Directive: raise the data-privacy/security posture â€” project data safe, APIs protected against
unauthorized access or manipulation. Built on the 11-task follow-up pass (`f58a92f`); one commit
per group, never pushed.

### Status table

| # | Group | Status | Commit | Notes |
|---|-------|--------|--------|-------|
| 1 | SEC-1 default-deny auth + SEC-3 auth throttles | **Done** | `af660de` | `JwtAuthGuard` registered as a global `APP_GUARD` (after `ThrottlerGuard`); `@Public()` only on OTP send/verify, refresh, Google/Apple sign-in, avatar stream and the places-photo proxy; redundant per-route `JwtAuthGuard` decorators removed so the JWT strategy runs exactly once per request; `refresh`/`google`/`apple` got `@Throttle 30/5min` (were only under the global 300/min) |
| 2 | SEC-4 photo-proxy throttle, SEC-7 avatar uuid pipe, social-token 500s | **Done** | `a52e7a2` | Both public photo routes throttled 120 req/min/IP (public + server-side billable fetch = cost-amplification risk); `ParseUUIDPipe` on `GET /users/:id/avatar` (a non-uuid reached Postgres and surfaced as an unhandled 500); malformed Google/Apple tokens now 400 `Invalid â€¦ token` instead of an unhandled 500 with a full stack trace in logs |
| 3 | SEC-5 `TRUST_PROXY` | **Done** | `91a4c95` | New optional env (`boolean string`, default `false`) â€” sets Express `trust proxy` to exactly 1 hop so throttling keys on real client IPs behind a proxy; off by default so direct connections cannot spoof `X-Forwarded-For` to bypass limits |
| 4 | SEC-2 dependency vulnerabilities | **Done** | `2bb7084` | npm `overrides`: `multer ^2.4.0` (4 DoS advisories on the upload path), `qs ^6.16.0`, `body-parser ^1.20.6`, `lodash ^4.18.1` (`_.template` injection), `file-type ^21.3.1` (ASF loop + ZIP bomb; only reachable via Nest's optional `FileTypeValidator`, which this codebase never uses), `uuid ^11.1.1`; unused direct `uuid` + `@types/uuid` removed; lockfile also picked up dev-only `babel-plugin-istanbul`/`handlebars` patches |
| 5 | SEC-6 container hardening | **Done** | `d5c240d` | New `backend/.dockerignore` (`.env*`, `*.jjs`/`*.jks`, `*.pem`/`*.key`, node_modules, uploads, dist out of the build context â€” the build stage's `COPY . .` previously baked them into image layers); Dockerfile switched to `npm ci`, runtime drops to unprivileged `USER node` with a writable `/app/uploads` |
| 6 | Docs | **Done** | (this commit) | `ADMIN.md` security section + `TRUST_PROXY` + refreshed test counts; this record |

### Verification (this pass)

- Backend: `npx tsc --noEmit` 0 errors; `npx jest` **146 tests / 14 suites** green after every group;
  `npx eslint src` 0 errors (1 pre-existing warning `razorpay-payment.provider.ts:45`).
- Integration: `INTEGRATION=1 npm run test:integration` **11 tests / 3 suites** green re-run after the dependency overrides (TypeORM/uuid tree changed underneath).
- Live smoke (backend on `:3199`, real DB/Redis): no token â†’ 401 on `auth/me`, `admin/users`,
  `places/saved`, `payments/create-order`, `rides`, `drivers/nearby`; valid OTP token â†’ 200 on
  `auth/me`, `places/saved`, `rides`; `@Public` surface reachable (otp/send 200, refresh reaches
  the service, photo allow-list 404, avatar 400-not-401); garbage social tokens 400 (observed the
  pre-fix 500 + stack); malformed avatar uuid 400; **multer 2.4.0**: real multipart avatar upload
  â†’ 200 with Cloudinary URL.
- Rate limiting, both directions: default â†’ 8 valid OTP sends from one IP with rotating
  `X-Forwarded-For` get **429 on #8** (spoofed header ignored); `TRUST_PROXY=true` â†’ 11 valid
  sends with rotating XFF all **200** (limit is 10) and a fresh XFF starts a fresh bucket
  (`X-RateLimit-Remaining: 9`).
- `npm audit --omit=dev`: **13 (1 low, 9 moderate, 3 high) â†’ 5 (0 high, 0 low)**.

### Residual / deferred

- The 5 remaining prod advisories are one `@nestjs/core` finding (GHSA-36xv-jgw5-4q75) fixed only
  in **Nest 12**, spread transitively to `@nestjs/{platform-express,platform-socket.io,typeorm,websockets}` â€”
  a major framework upgrade; owner decision, re-audit after upgrading.
- Guard-based throttling cannot see requests rejected before the router: malformed-JSON bodies
  (body-parser 400) and unknown paths (404) bypass every route guard. Cost per request is tiny
  (â‰¤100 kB parse / instant 404), so the accepted mitigation is edge rate limiting
  (CDN/platform load balancer/nginx), not more app code.
- Container changes (`Dockerfile`, `.dockerignore`) are inspection-only here â€” no Docker Desktop
  on the dev machine. Owner: `docker compose build` + boot + upload smoke after pulling.
  Pre-existing, untouched: compose's `npm run migration:run` needs `ts-node` (a devDependency)
  that the prod image never installed â€” already the case before this pass.

---

## Security hardening pass 2 (2026-10-09) â€” brute force, takeover, abuse controls

Third pass, 12 tasks (0-11), one commit per task, branch `security-hardening` (not pushed).
Ground rules as before: no `.env*`/keystore/`uploads/` reads or edits (`.env.example`
template excepted - names and comments only), no edits to existing migrations (new files
only), no hard-coded colors, no `any` in new code.

### Status table

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 0 | Secrets-in-git + audit verification | **Done** | `2c0bf4a` | Nothing sensitive was ever tracked (history scan found only the committed `backend/.env.example` / `frontend/.env.example` templates; gitleaks/trufflehog not installed - `git ls-files` + `git log --diff-filter=A` cover the same surface). Backend `npm audit --omit=dev`: **0 high / 0 critical** (5 moderate = known Nest-12 chain). Frontend: all 18 high + 1 critical are **build-time** tooling (metro, @expo/cli, node-forge via code-signing-certificates, glob braces/micromatch) - none ships in the app bundle, so not runtime-reachable. Non-breaking `npm audit fix` removed the critical (26 -> 23; patched shell-quote/node-forge/braces/micromatch/source-map-js in range); the remaining 16 high need expo/react-native majors (`fixAvailable: false`). `TRUST_PROXY` wiring confirmed in `main.ts` + ADMIN.md; Render-side value remains an owner action. |
| 1 | OTP brute force + admin takeover | **Done** | (this commit) | Per-phone failed-verify lockout on `otp:fail:<phone>` (10 failures / 60 min -> 429 for the rest of the window) that `issue()` never resets - only a successful verify clears it; a locked phone also refuses new sends and stops comparing codes entirely (no guesses run). OTP width is end-to-end now: `VerifyOtpDto` `^\d{4,8}$`, `POST /auth/otp/send` returns `otpLength` (`OTP_LENGTH` clamped to the 4..8 window), the OTP screen renders that many boxes and resizes on resend (default 4 when the field is absent - old servers and old apps keep working). `ADMIN_PHONES` promotion through OTP login is refused below a 6-digit code (warning logged, no phone digits; existing admins are never demoted). `.env.example`: `OTP_LENGTH` flip-to-6 note. |
| 2 | Social sign-in takeover | **Done** | (this commit) | (a) Audience: confirmed both installed libraries SKIP the aud check when audience is undefined (google-auth-library `oauth2client.js` only verifies aud "if we have one"; apple-signin-auth 2.1.0 spreads `{audience}` into jsonwebtoken options) - so with the vars unset any token minted for another app was accepted. Both now REQUIRED when `NODE_ENV=production` (boot refusal in `env.validation`) and the services throw **503** before any verification when unset. (b) Email pre-hijack: new `users.emailVerified` column (new migration `1791500000000-AddUserEmailVerified`, schema-repair + `REQUIRED_SCHEMA`), `updateMe` invalidates the flag on any address change, Google sign-in sets it only for the exact address Google verified, link-by-email ONLY when the stored flag is true (otherwise a separate account is started without reusing the taken address - rejecting instead would let a pre-set address DoS the victim sign-up), emails lower-cased everywhere before compare/store (Apple too). |
| 3 | Free rides by cancelling mid-trip | **Done** | (this commit) | `rides.service.cancel()` refuses a RIDER cancel once `in_progress` (409 with guidance: ask the driver to end the trip or contact support) — closes the free-ride path where the rider cancelled at the destination and paid nothing while the driver's `complete()` then failed; the check runs before any timer clear or save, so a refused cancel changes nothing. Drivers may end an in-progress trip only with a non-blank reason (service-level guard — the DTO `MinLength(3)` passes whitespace), and that cancel commits TOGETHER with an `admin_audit_logs` row (`action: ride_cancel`, `meta.flaggedForReview` + `fromStatus: in_progress`, written through the SAME queryRunner transaction — no flag, no commit). Admin cancel path unchanged. Frontend: new `getApiStatus()` in `api/client.ts`; the cancel handler shows "Cannot cancel now" on 409 and keeps the active ride intact. |
| 4 | Booking/matching races | **Done** | (this commit) | `create()`'s `count()` pre-check cannot serialize two concurrent `POST /rides` — both saw zero and double-booked. Closed in the only place it can be: a **partial unique index** `UQ_rides_active_per_rider` on `riderId WHERE status IN (requested, matched, driver_en_route, in_progress)` — migration `1791600000000` (legacy duplicates resolved first: keep the furthest-progressed ride, cancel older stragglers as `system`), declared on `RideEntity` with the same name/shape so `DB_SYNCHRONIZE` keeps it (TypeORM drops indexes the entity does not know), asserted by `findSchemaProblems` (dev auto-repair / prod report) and re-applied by schema-repair. `create()` maps Postgres `23505` onto the same friendly 400 and never reaches the driver search. `rematch()` ("Retry" after no-drivers) read the row **lock-free** then saved via `matchNearestDriver`: a concurrent cancel/decline/timeout landing in between let a STALE row overwrite fresh state (resurrecting a cancelled ride, or a second offer). It now validates AND matches under `withRideLock`, with every ride write going through the transaction manager (`saveRide()` joins the txn when a manager is passed; `create()`'s fresh row keeps the plain save — its race belongs to the index). Tests +5 (unique-violation 400, ownership re-check, dead-ride refusal, in-txn offer with no out-of-txn write, in-txn no-drivers cancel). |

### Verification (this pass)

- Task 0: frontend `npx tsc --noEmit` 0 errors after the lockfile fix.
- Task 1: backend `npm run build` 0 errors, `npm test` **155 tests / 15 suites** green
  (`otp.service.spec` +4 lockout cases, new `auth.service.spec` +5); frontend
  `npx tsc --noEmit` 0, `npx eslint src` 0.
