# AUDIT.md — Vazhi (CarAgencyMobile), Phase 0 (read-only)

> **STATUS UPDATE — 2026-10-05, Admin Dashboard Overhaul + Bug Fix Pass.**
> This document is the *as-found* Phase-0 baseline (2026-10-02). Line references
> below describe the code at that time. Resolution status of its findings:
>
> - **Fixed (earlier hardening pass)**: B1 (`profileComplete` gate), B2/N2 (client role removed from flow/DTOs), B3 (`ApprovedDriverGuard`),
>   B5 (SecureStore persistence + `restoreSession` + splash), B6 (rotating hashed refresh + `POST /auth/logout`), B7 (prod boot refusal for `OTP_DEV_MODE`),
>   B9 (socket `ride:join` membership, `driver:location` approved+ownership check, `?token=` removed, CORS from `CORS_ORIGIN`),
>   B10 `accept()` (transaction + pessimistic lock), B11 (DB-backed approval), B12 (`DB_SSL_REJECT_UNAUTHORIZED`, prod synchronize refusal), B14 (`AGENTS.md` rewritten for React Navigation),
>   N1 (JWT strategy DB lookup), N3 (active-ride guards, one-review guard), N4 (application lifecycle `pending` default + admin writers), N5 (register banner deleted, `activeMode` gating).
> - **Fixed (Admin Dashboard Overhaul pass, this repo's Phases 1–6)**: remaining B10 races (`decline`/`start`/`verifyPickupOtp`/`complete` in `withRideLock`,
>   timer cleared post-commit), N6 (Redis `quit()` on shutdown, geo heartbeat ZSET + 90 s ghost sweep, logged GEOSEARCH failures), N7 (seed refuses production),
>   plus the spec bug list A-1…A-16, S-1 (guard added), P-1/P-2, R-1…R-7, AU-1…AU-3, D-1…D-4, PR-1 (copy), M-1, T-1 — see `CHANGES.md`.
> - **Owner action pending**: B15/S-1 key rotation (see `ADMIN.md` — files themselves untouched by design).
> - **Accepted/deferred**: in-memory offer timers single-instance (documented, R-5; Redis/BullMQ when scaling out), seed `Math.random` plates (non-security; seed already prod-blocked),
>   local-disk uploads (swap to S3/R2 before production), B8 (email `email_verified` check on Google link — open), legacy `users.role='driver'` values (normalize in a future migration).

Date: 2026-10-02. Code as found in working tree (includes earlier hardening + unified-tabs work).
Rule: no source changes in this phase; this file is the only write.
Legend: blocker = flow broken or security hole; major = wrong behavior / data risk; minor = hygiene.

## Flows traced (files involved → what works → gaps)

### F1 First launch → language → sign-in (OTP/Google/Apple) → profile → rider home
- Files: `frontend/src/navigation/OnboardingNavigator.tsx:18-149`, `AppNavigator.tsx:21-68`, `screens/onboarding/*`, `api/auth.ts:13-27`, `store/authStore.ts:34-106`, `backend/src/auth/auth.service.ts:38-135`, `auth.controller.ts:16-50`, `otp.service.ts:1-67`.
- Works: OTP send/verify with Redis + `devOtp` only when `OTP_DEV_MODE && !prod`; Google/Apple login returns tokens + `isNewUser`; new OTP users route to `CompleteProfile` (name-only, `screens/onboarding/CompleteProfileScreen.tsx:25`).
- Gaps: B1 still open (see below) — `login()` sets `isAuthenticated=true` (`authStore.ts:55`) before `navigate('CompleteProfile')`, and `AppNavigator` swaps Onboarding→Main immediately, so the profile screen is skipped on a cold render; placeholder names persist. No `profileComplete` gate exists anywhere. `RoleSelectionScreen.tsx` is dead code (file exists, no longer in navigator). Google/Apple `role` args are ignored (`_role`) but DTOs still accept `role`.

### F2 Returning launch, session restore, 15-min expiry
- Files: `store/authStore.ts`, `lib/tokenManager.ts`, `api/client.ts:24-75`, `lib/socket.ts:20-102`, `backend/src/auth/tokens.service.ts`, `auth.service.ts:169-182`.
- Works: `POST /auth/refresh` exists (`auth.controller.ts:28`) and axios 401 interceptor retries once with queue (`client.ts:34-75`); socket `connect_error` containing jwt/401 calls `tokenManager.handleUnauthorized()` → logout.
- Gaps: no persistence — `authStore` is plain Zustand, `tokenManager` is memory-only; no `expo-secure-store`/`AsyncStorage`, no `hydrated`/splash, so restart = logged out (B5 open). Refresh tokens are not rotated and not stored hashed server-side; access+refresh share identical payload (`tokens.service.ts:21-35`, no `jti`/type); no `POST /auth/logout`. Socket token is captured at `connectSocket(token)` and never refreshed on silent HTTP refresh, so WS dies at 15 min until re-login/reconnect.

### F3 Rider booking happy path
- Files: `navigation/RiderHomeStackNavigator.tsx:74-100` (`allowUpgrade:true` now sent), `api/rides.ts:28-46`, `screens/rider/{DestinationSearch,VehicleSelection,RideDetails,FindingDriver,YouGotTheRide,DriverEnRoute,TripProgress,ReviewRide,PaymentFareBreakdown,RideCompleted}Screen.tsx`, `backend/src/rides/rides.service.ts:create/matchNearestDriver/accept/start/verifyPickupOtp/complete`, `fare-catalog.ts`, `drivers/drivers.service.ts:findNearby`, `geo.service.ts`.
- Works: create → nearest-driver match (5 km → ×2 → upgrades) with self-match exclusion (`c.userId !== ride.riderId`); `ride:request` emitted to driver user-room; rider polls `GET /rides/:id` every 3 s; OTP → in_progress → complete recomputes fare; review → payment order → verify → receipt.
- Gaps: fare trusts client pickup/dropoff (`haversineKm` on client coords, no server geocode/cap) and driver-supplied `actualDistanceKm` (no max/delta check); promo resolved server-side (unknown → 0, fixed earlier); `total = parts − discount` now consistent on both sides. No guard against double-booking while rider already has an active ride; no guard against online-driver booking as rider. `complete()` trusts distance; `review()` has no one-review guard (re-review re-applies rating).

### F4 Cancels / timeout / 3 declines
- Files: `rides.service.ts:115-146 (scheduleOfferTimeout), 67-105 (startup sweep), 322-364 (accept/decline), 478-505 (cancel)`, `screens/shared/CancelRideConfirmationScreen.tsx`, `FindingDriverScreen.tsx:37-81`.
- Works: 15 s offer timer with re-arm on restart (sweep re-arms unexpired offers, expires stale ones, cancels after ≥3 declines); rider poll stops on `cancelled`; cancel infers ownership (riderId vs driver profile) instead of trusting JWT role.
- Gaps (B10 partial): timers still in-memory `Map` (single-instance only); `accept()` calls `clearOfferTimeout(rideId)` before validation, so a failed accept leaves no timer; no DB transaction / pessimistic row lock on accept/decline/cancel/timeout → races can double-assign or double-release a driver.

### F5 Driver online → offer → accept → OTP → complete → earnings
- Files: `screens/driver/DriverDashboardScreen.tsx:45-196`, `api/drivers.ts:39-50`, `backend/src/drivers/drivers.service.ts:setStatus/updateLocation/applyRating/getMyProfile`, `rides.service.ts:322-476`, `screens/driver/{RideRequestNearby,TurnByTurnNavigation,DriverOtpEntry,RideAvailableAgain,DriverTrips,Earnings,Account}Screen.tsx`.
- Works: fresh-GPS → `updateLocation` → `setStatus(true)` (checks verificationStatus + 2-min freshness) → Redis GEOADD; 5 s heartbeat; `ride:request` → `RideRequestNearby` → accept+enRoute → navigation → OTP → complete → `applyRating` (atomic SQL) → earnings from `fareBreakdown->>'total'` (UTC day boundary).
- Gaps: no admin approval in practice — `registerOrUpdate` auto-approves unless `DRIVER_AUTO_APPROVE=false` (defaults true), so `pending` is unreachable in dev; `verificationStatus` defaults `'approved'` at DB level. No `suspended` state, no force-offline. `getMyProfile` returns `null` when unregistered (frontend handles). `DriverDashboard` still shows a `registerBanner` → `BecomeDriver` (must be deleted per §3.9). Location heartbeat is foreground `setInterval` only (dies on background/lock); no `expo-task-manager`.

### F6 Socket lifecycle
- Files: `lib/socket.ts`, `lib/tokenManager.ts`, `hooks/useSocket.ts`, `backend/src/rides/gateway/rides.gateway.ts:32-152`.
- Works: `/realtime` namespace, `auth:{token}` (+ legacy `?token=`), per-user rooms, `ride:join/leave`, 2 s throttle + lat/lng validation on `driver:location`, `connect_error` → logout, dynamic-import role refresh on reconnect, `removeAllListeners` on disconnect.
- Gaps (B9 open): `ride:join` has no membership check (comment at `rides.gateway.ts:80-84` admits any authed user can join any `ride:<id>`); `driver:location` authorizes by JWT `role==='driver'` only — no DB approved-driver check, no ride-membership check; `?token=` query still accepted (URL log leak); gateway CORS `origin:'*'`; HTTP CORS allowlist only partially enforced (`main.ts:14-18`).

### F7 Payments dev vs Razorpay
- Files: `payments/payments.service.ts:18-86`, `payments.module.ts:23`, `providers/{dev,razorpay}-payment.provider.ts`, `api/payments.ts`, `screens/rider/PaymentFareBreakdownScreen.tsx`.
- Works: `PAYMENTS_DEV_MODE` selects stub (auto-approves) vs Razorpay (order in paise, HMAC `timingSafeEqual`, 10 s timeout); cash path settles immediately; verify returns `total + tip`.
- Gaps: dev mode defaults `'true'` when env missing (fail-open, no prod boot refusal); no idempotency (repeat `createOrder` rows, deterministic `cash_<rideId>` duplicates); no already-paid check; no amount-match check on verify; mixed rupee/Paise units across layers.

### F8 Apply → review → approve/reject → mode switch (target design, not yet built)
- Status: does not exist. Current surrogate: `POST /drivers/register` (JSON URIs, any authed user, auto-approve) → local `role:='driver'` + token refresh + socket reconnect (`BecomeDriverScreen.tsx`). No `driver_applications` table, no `status pending/approved/rejected/suspended` lifecycle (only `verificationStatus` with no admin writer), no `/drivers/apply`, `/drivers/application`, `/admin/*`, no file uploads (`multer`/`StorageService`), no `AdminTabNavigator`, no `activeMode`, no forced return-to-rider on suspend/reject.

## Bug checklist (§2 B1–B15) — verified against current code

| ID | Severity | File:line | Status + evidence |
|----|----------|-----------|-------------------|
| B1 | blocker | `frontend/src/navigation/OnboardingNavigator.tsx:104-114`, `store/authStore.ts:50-63`, `navigation/AppNavigator.tsx:27-32` | OPEN. `login()` sets `isAuthenticated=true` then `navigate('CompleteProfile')`, but AppNavigator swaps stacks on the same render, so the profile screen is skipped. No `profileComplete` flag exists on server or client. |
| B2 | blocker | `frontend/src/store/authStore.ts:28,49`, `backend/src/auth/entities/user.entity.ts:56-65`, `auth.service.ts:55-80` | PARTIAL. Client role selection removed from flow (dead `RoleSelectionScreen.tsx:12`), `verifyOtp` defaults `rider`, `toFrontendUser()` now returns `id+role`. Still open: `role` in DTOs/store remnants, JWT role stale until refresh, no `/auth/me`-driven role source of truth on boot (no persistence/boot fetch). |
| B3 | blocker | `backend/src/drivers/drivers.controller.ts:16-45`, `common/guards/roles.guard.ts` | FIXED (interim). `register/me/status/location` now `JwtAuthGuard` only; role upgraded on register. Target design (`ApprovedDriverGuard` + DB check) not built. |
| B4 | blocker | `backend/src/drivers/drivers.service.ts:39-92,108-131`, `frontend/src/screens/driver/*` | PARTIAL. `setStatus` blocks `pending/rejected`, but auto-approve default true + DB default `'approved'` means no real verification. `DriverAccountScreen` self-registers; register banner still present. No admin. |
| B5 | blocker | `frontend/src/store/authStore.ts:34-106`, `lib/tokenManager.ts` | OPEN. Memory-only; no secure-store/async-storage, no `hydrated`/splash, no `/auth/me` boot restore. |
| B6 | blocker | `backend/src/auth/auth.controller.ts:28-31`, `auth.service.ts:169-182`, `frontend/src/api/client.ts:30-75` | PARTIAL. Refresh endpoint + 401 retry exist. Missing: rotation, server-side hash/revocation, `/auth/logout`, socket token refresh. |
| B7 | blocker | `backend/src/auth/auth.service.ts:47`, `auth.module.ts:43`, `otp.service.ts:31-37`, `rides.service.ts:44-49`, `frontend/src/screens/onboarding/OTPVerificationScreen.tsx:71` | PARTIAL. `crypto.randomInt` adopted; dev-OTP box gated `__DEV__`; prod leak path closed (`devMode && !isProd`). Still open: `OTP_DEV_MODE ?? 'true'` fail-open default; `|| !result.sent` removed (good) but no prod boot refusal; seed uses `Math.random` (non-security, acceptable). |
| B8 | major | `backend/src/auth/auth.service.ts:82-110` | OPEN. `isNewUser` computed before email-link lookup; no `email_verified` check before linking. |
| B9 | blocker | `backend/src/rides/gateway/rides.gateway.ts:32,80-118`, `src/main.ts:14-18` | OPEN. No room membership checks; driver-event auth by JWT role only; `?token=` accepted; gateway CORS `*`. |
| B10 | blocker | `backend/src/rides/rides.service.ts:55,107-146,322-364` | PARTIAL. Startup sweep exists and re-arms/expires stale `requested` rides. Still open: in-memory timers (multi-instance unsafe); `accept()` clears timer before validation; no transaction/pessimistic lock. |
| B11 | major | `frontend/src/lib/socket.ts:20-93`, `backend/src/rides/gateway/rides.gateway.ts:44-62,104` | PARTIAL. Socket re-reads role fresh on reconnect; `BecomeDriver` refreshes JWT + reconnects. Still open: no `activeMode`/`ApprovedDriverGuard` concept; driver events keyed to JWT role, not DB approval. |
| B12 | major | `backend/src/app.module.ts:37-46`, `src/config/typeorm.datasource.ts:18-20` | PARTIAL. `app.module` compares `DB_SYNCHRONIZE==='true'` and uses `rejectUnauthorized:true` in prod. Still open: `typeorm.datasource.ts:20` hardcodes `rejectUnauthorized:false`; no `DB_SSL_REJECT_UNAUTHORIZED`; no prod guard against `synchronize=true`. |
| B13 | blocker | `backend/src/config/env.validation.ts:86-92`, `auth.module.ts:43`, `payments/payments.module.ts:23` | OPEN. `OTP_DEV_MODE`/`PAYMENTS_DEV_MODE` optional, default-true at usage sites, no `NODE_ENV=production` refusal. |
| B14 | minor | `frontend/AGENTS.md` | OPEN. Still describes Expo Router/`src/app/`; repo uses React Navigation (`src/navigation/*`). Rewrite deferred to Phase 1 per instructions. |
| B15 | — | `backend/.env`, `frontend/.env`, `*.jks` | REPORT-ONLY (no file contents touched). Three keystores + env files exist in working folder and are gitignored; if the folder was ever shared, rotate DB/Redis/JWT/MSG91/Razorpay secrets. No keystore changes made. |

## New blockers/majors found in this audit (beyond §2)

| ID | Severity | File:line | Description + proposed fix |
|----|----------|-----------|----------------------------|
| N1 | blocker | `backend/src/auth/strategies/jwt.strategy.ts:28-30` | `validate()` returns token claims without DB lookup: deleted/`isActive=false` users and role changes stay valid until expiry. Fix: load user, reject inactive/missing (Phase 1). |
| N2 | blocker | `backend/src/auth/auth.service.ts:82-135`, DTOs `social-signin.dto.ts:5,11`, `verify-otp.dto.ts:18` | `role` still accepted on OTP/Google/Apple and `setRole` remains in store — contradicts one-login goal and invites stale-role bugs. Fix: drop `role` from DTOs/API/store (Phase 1). |
| N3 | major | `backend/src/rides/rides.service.ts:create/complete/submitReview` | No active-ride guards: rider can book while already riding; online/on-trip driver can book as rider; `actualDistanceKm` unbounded; unlimited re-reviews inflate `totalTrips`. Fix: active-ride checks, distance clamp, one-review guard (Phase 6). |
| N4 | major | `backend/src/drivers/drivers.service.ts:registerOrUpdate` | `verificationStatus` default `'approved'` (entity + migration) + `DRIVER_AUTO_APPROVE` default true = no real review queue. Target needs `pending` default + admin writers (Phase 2/3). |
| N5 | major | `frontend/src/screens/driver/DriverDashboardScreen.tsx:226-237,311` | `registerBanner` still exists and rider Profile exposes driver CTA while §3.9 cleanup not done; unified `Main` tabs expose Driver tab to unapproved users. Fix in Phase 4/5 with `activeMode` gating. |
| N6 | minor | `backend/src/config/redis.module.ts`, `drivers/geo.service.ts` | No Redis `quit` on shutdown; geo/meta keys have no TTL (ghosts on crash); `searchNearby` catch swallows errors silently. Add logging/TTL/cleanup (Phase 6). |
| N7 | minor | `backend/src/database/seeds/seed.ts:24-50,83-100` | No `NODE_ENV` guard; rerun duplicates drivers; `Math.random` plates/ratings. Gate to non-prod + idempotent seed (Phase 6). |

## Target-design gaps (nothing built yet)

`users.role` still `rider|driver` (needs `rider|admin` + `profileComplete`); no `driver_applications` table or `status/license/rc/reviewed*` columns as specified (only `verificationStatus` surrogate); no `ApprovedDriverGuard`; no `/drivers/apply|application`, `/admin/*`, `/admin/files/*`, `/auth/logout`; no `multer`/`StorageService`/`backend/uploads/`; no `ADMIN_PHONES`/`UPLOAD_DIR`/`MAX_UPLOAD_MB`/`DB_SSL_REJECT_UNAUTHORIZED`; no `AdminTabNavigator`; no `activeMode`; no suspend/reject force-offline socket event.

## Env/DB notes (names only, no values)

Reviewed `backend/src/config/env.validation.ts` (no secret values read). Current gaps vs §5: `ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `DB_SSL_REJECT_UNAUTHORIZED` missing; `CORS_ORIGIN` exists but gateway ignores it. Migrations present: `InitSchema`, `AddSocialLogin`, `AddDriverDocuments` (+ ride-offer columns noted missing in earlier audits — verify before Phase 2).
