# CHANGES.md — one login, driver applications, admin review, mode switching

Phases 1–6 implemented in one pass (no approval gates per owner request).
Deviations from the prompt are noted inline with justification.

## What changed (by area)

### Backend — auth foundation (Phase 1)
- Changed: `src/auth/entities/user.entity.ts` (`profileComplete`, `refreshTokenHash`, role `rider|driver|admin`), `src/auth/auth.service.ts` (rewrite: no client roles, `email_verified` gate on Google link, `isNewUser` after link, rotating refresh with SHA-256 hash + revocation, `logout`, `me` returns `driverStatus`), `src/auth/auth.controller.ts` (`POST /auth/logout`, role-less social DTOs), `src/auth/auth.module.ts` (DriverEntity repo, `OTP_DEV_MODE` default `false`), `src/auth/tokens.service.ts` (admin-ready role), `src/auth/strategies/jwt.strategy.ts` (DB lookup, rejects inactive), `src/auth/dto/{verify-otp,social-signin,update-me}.dto.ts` (role removed; avatar allowed), `src/common/frontend-contracts.ts` + `toFrontendUser()` (now `id/role/profileComplete/driverStatus`, field-for-field), `src/common/guards/roles.guard.ts` (admin), `src/payments/{payments.module,payments.controller}.ts` (dev default `false`; any-authed + ownership in service).
- Added: migration `1700000000300-AddUserProfileComplete.ts` (columns + backfill `profileComplete=true` where name not `New %`).

### Backend — driver applications (Phase 2)
- Decision (one line): extended the `drivers` table instead of a new `driver_applications` table — one profile per user, so application state on the same row avoids join/sync bugs.
- Changed: `src/drivers/entities/driver.entity.ts` (`status pending|approved|rejected|suspended`, `rejectionReason`, `reviewedByUserId/At`, `submittedAt`, `licenseImagePath/rcImagePath/vehiclePhotoPath`; `verificationStatus` kept as legacy mirror), `src/drivers/drivers.service.ts` (`registerOrUpdate` now yields `pending`, new `applyApplication`/`getApplication`, `setStatus` requires `approved`), `src/drivers/drivers.controller.ts` (`POST /drivers/apply` multipart + `GET /drivers/application`; `status`/`location` now `ApprovedDriverGuard`), `src/rides/rides.controller.ts` (create/review/payments open to any authed user; driver routes use `ApprovedDriverGuard`), `src/rides/rides.service.ts` (no double-booking, online drivers can't book, self-match exclusion kept), `src/payments/payments.controller.ts`.
- Added: migration `1700000000400-AddDriverApplicationLifecycle.ts` (columns + backfill `status` from `verificationStatus`, existing drivers → `approved`), `src/drivers/storage.service.ts` (local disk `backend/uploads/`, JPEG/PNG/PDF magic-bytes check, 5 MB cap, UUID names), `src/drivers/guards/approved-driver.guard.ts` (DB check, never JWT role), `src/drivers/dto/apply-driver.dto.ts`, `@types/multer` dev dep.

### Backend — admin (Phase 3)
- Added: `src/admin/{admin.module,admin.controller,admin.service}.ts`, `src/admin/dto/{list-applications-query,review-application}.dto.ts`. Routes: `GET /admin/driver-applications?status=&page=&limit=`, `GET /:id`, `POST /:id/approve` (idempotent), `POST /:id/reject` (reason 5–300, idempotent), `POST /admin/drivers/:id/suspend` (idempotent, forces offline + geo removal + `driver:status` socket push), `GET /admin/files/:applicationId/:kind` (base64 JSON; `?raw=1` bytes). First admins come only from `ADMIN_PHONES` (bootstrap promotion). `RidesGateway.emitDriverStatus()` added; `RidesModule` now exports the gateway.
- Changed: `src/app.module.ts` (AdminModule), `src/config/env.validation.ts` (`ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`).

### Backend — remaining hardening (Phase 6)
- `src/rides/gateway/rides.gateway.ts`: `ride:join` membership-verified (rider or assigned driver only); `driver:location` requires approved status + ride ownership (B9/B11); CORS from `CORS_ORIGIN` (no `*` in prod); `?token=` query support removed.
- `src/rides/rides.service.ts`: `accept()` uses transaction + pessimistic write lock, timer cleared only after commit; `decline()` validates before clearing timer; `complete()` clamps driver distance (≤3× estimate, ≤500 km); `submitReview()` rejects second reviews.
- `src/config/typeorm.datasource.ts` + `app.module.ts`: `DB_SSL_REJECT_UNAUTHORIZED`, prod `synchronize=true` refusal (also in `validateEnv` with `OTP_DEV_MODE`/`PAYMENTS_DEV_MODE` prod refusal). `src/main.ts`: shutdown hooks, numeric port parse.
- `src/drivers/geo.service.ts`: GEOSEARCH failures now logged (was silent). `src/database/seeds/seed.ts`: refuses to run in production.

### Frontend — auth + navigation (Phase 1, 3, 4)
- Changed: `src/store/authStore.ts` (server-truth user, `activeMode`, `hydrated`, expo-secure-store persistence, boot `restoreSession`, server-revoking logout), `src/api/auth.ts` (no role args; `me`/`logout`), `src/navigation/OnboardingNavigator.tsx` (sign-in only; no intra-stack CompleteProfile nav), `src/navigation/types.ts` (no RoleSelection/CompleteProfile in onboarding; `Main`, `Admin`, `BecomeDriver`, `AdminTabParamList`), `src/navigation/AppNavigator.tsx` (splash → Onboarding | CompleteProfile (`profileComplete===false`) | Admin (`role==='admin'`) | Main), `src/screens/onboarding/CompleteProfileScreen.tsx` (name-only), `AGENTS.md` (React Navigation section rewritten per rule 1).
- Added: `src/lib/tokenManager.ts` (cycle-free token hub), `src/api/admin.ts`, `src/navigation/AdminTabNavigator.tsx`, `src/screens/admin/{AdminApplicationsScreen,AdminApplicationDetailScreen,AdminDriversScreen}.tsx` (filter chips, pull-to-refresh, pagination, base64 docs, approve/reject-with-reason confirm dialogs, suspend).
- Changed (Phase 4): `src/api/drivers.ts` (`apply` FormData + progress, `application()`), `src/screens/rider/ProfileScreen.tsx` (5-state Driver section: none/pending/rejected/approved/suspended; avatar upload; switch-to-driver with socket reconnect), `src/screens/driver/BecomeDriverScreen.tsx` (multipart apply, progress %, plain size/type errors), `src/screens/driver/DriverDashboardScreen.tsx` (register banner deleted; pending card; Switch-to-Rider with offline-first + trip-block + heartbeat stop + socket reconnect), `src/navigation/MainTabNavigator.tsx` (`driver:status` listener + foreground `/auth/me` refresh force Rider mode), `src/components/primitives/DocumentUploader.tsx` + avatar picker (lazy `expo-image-picker`, Expo-Go-safe alert).
- Added deps: `expo-secure-store`, `expo-image-picker` (both via `npx expo install`). `app.json`: camera/photo permission strings + image-picker plugin.
- Deviation: kept the unified 4-tab `Main` shell instead of splitting back into `RiderMain`/`DriverMain` — one login with tab-level mode buttons satisfies "switch between modes" with less nav-state loss; `activeMode` is persisted and honored by Profile/Driver screens.

### Rider cleanup (Phase 5)
- Grep `driver|online|offline|register` over `screens/rider` + `RiderTabNavigator`/`RiderHomeStackNavigator`: remaining hits are legitimate trip context ("Searching for your driver", assigned-driver cards, `driver_en_route` status keys, "Pay driver directly") plus the required §3.6 Profile CTA and the Trips Booked/Driven toggle. No "Complete your driver registration", no `registerBanner`, no online/offline `Switch`, no `AccountTab`/`DriverMain` links from rider screens. `DriverDashboard` register banner deleted (replaced by status cards). Legacy `DriverTabNavigator`/`DriverAccountScreen`/`RoleSelectionScreen` remain as dead code (not in any navigator).

## Migrations to run

```bash
cd backend
npm run migration:run   # applies 0300 (profileComplete/refreshTokenHash) + 0400 (application lifecycle)
```

`uploads/` directory is created on first upload; it is git-ignored.

## Environment variables to add (names only)

`ADMIN_PHONES`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `DB_SSL_REJECT_UNAUTHORIZED`, `CORS_ORIGIN` (now enforced on HTTP + gateway). Production boot fails with `OTP_DEV_MODE=true`, `PAYMENTS_DEV_MODE=true`, or `DB_SYNCHRONIZE=true`.

Frontend (optional): `EXPO_PUBLIC_GOOGLE_PLACE` (alias `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`) — Google Places API (New) key used for real place photos on the home place-cards; `EXPO_PUBLIC_GOOGLE_MAPS_KEY` — Google *Maps Static API* imagery. Without a Google key, all place images fall back to Mapbox Static Images via the existing `EXPO_PUBLIC_MAPBOX_TOKEN`.

## Manual test script (from §9) — status

1. New phone OTP → name → Rider home; restart → still signed in. NOT RUN (needs device; code paths: `restoreSession` + profile gate).
2. Profile shows Become a driver; rider screens free of driver controls. VERIFIED via grep (see Phase 5).
3. Apply with images → Under review; driver endpoints 403. CODE-VERIFIED (`ApprovedDriverGuard`); live 403 NOT RUN.
4. Admin rejects with reason → user sees reason, can re-apply. CODE-VERIFIED; live NOT RUN.
5. Re-apply → approve → Switch to Driver mode appears. CODE-VERIFIED; live NOT RUN.
6. Driver online → rider books → offer → accept → OTP → complete → earnings. Pre-existing flow preserved; live two-device NOT RUN.
7. Switch to Rider while online → auto-offline; on trip → blocked. CODE-VERIFIED (`switchToRider`); live NOT RUN.
8. Suspend while online → app drops to Rider, vanishes from nearby. CODE-VERIFIED (`forceOffline` + `driver:status` + listener); live NOT RUN.
9. Idle 20 min → next action works (refresh rotation). CODE-VERIFIED (rotation + interceptor); live wait NOT RUN.
10. User A cannot join B's ride room. CODE-VERIFIED (membership check); live socket test NOT RUN.

## Checks run

- `cd backend && npm run build` — PASS. `npx tsc --noEmit` (both) — PASS.
- `cd frontend && npx expo lint` — 28 pre-existing errors (Animated refs, set-state-in-effect in untouched primitives/screens); zero new errors from Phase 1–4 files beyond that pattern.
- `npx expo-doctor` — 20/21; only failure is expo `57.0.25` vs `~57.0.26` patch (left alone per no-upgrade rule).
- Backend was not running in this environment, so curl status codes could not be captured — endpoints are compile-verified only.

## Risks / unverified

- No live two-device or 20-minute idle test (see script above).
- In-memory offer timers remain single-instance; `decline`/`cancel` races narrowed but only `accept` holds a pessimistic lock.
- Local-disk uploads vanish on ephemeral hosts — S3/R2 swap needed before production.
- `users.role` still admits legacy `driver` values in DB; new code treats approval status as truth, but a future migration should normalize to `rider|admin`.
- Lint errors predate this work and were intentionally left untouched (out of scope).

## Review round — OTP display, mode switching, interactive pickup map

Changed (frontend only, 4 files):

- `src/screens/onboarding/OTPVerificationScreen.tsx` — dev OTP box gated on the server-provided `developmentOtp` presence instead of `__DEV__` (release bundles have `__DEV__===false`, so the box never showed in release builds); tap the box to auto-fill. Backend chain unchanged and already correct (`OTP_DEV_MODE=true`, non-prod boot, `DevSmsProvider` logs `[DEV OTP]`).
- `src/screens/rider/ProfileScreen.tsx` — driver account mode switch: the Profile tab (same screen in both modes) previously showed "Switch to Driver mode" even while already in driver mode; pressing it no-op'd the mode but bounced the socket and wiped ride state. Now shows "Switch to Rider mode" in driver mode, takes an online driver offline first (blocks on failure so no ghost-online driver remains), and both switch directions block while a trip is active (`matched|driver_en_route|in_progress`).
- `src/components/primitives/RealMapView.tsx` — interactive pickup pointing: `onRegionDidChange` + `properties.isUserInteraction` (gesture settles only; Android verified, iOS best-effort) calls new `onPickupPointed` with the map centre (`visibleBounds` midpoint fallback), debounced 150 ms. Camera centre frozen after mount (native `stop` re-applies on every prop-identity change — the old inline array snapped back to zoom 14 on each re-render); pickup re-centring now arrival-only with a last-target key so pointing/focus never re-runs an identical fly; `mapReady` gate via `onDidFinishLoadingMap`.
- `src/screens/rider/HomeDashboardScreen.tsx` — map is now interactive (removed `interactive={false}`): pan/pinch/tap sets the pickup (reverse-geocoded, newest gesture wins via sequence counter, initial GPS fix no longer overwrites a pointed pickup). Gesture routing: ScrollView `box-none`, map-area spacer `none`, header `box-none` so map drags and sheet scroll no longer fight. Morph/annotation rows `box-none` (taps no longer fall through to the map and teleport the pickup); white address bar is tappable → search. Morph bar now lands at `insets.top + 8` (same spot as the pinned sticky pill — seamless crossfade, keeps the bar clear of the green location dot at map centre when focused).

Checks: `cd backend && npm run build` PASS; `cd frontend && npx tsc --noEmit` PASS; eslint on the 4 changed files = Home/OTP clean, RealMapView + ProfileScreen exactly at the pre-existing HEAD baseline (2 exhaustive-deps warnings; 1 `loadApp()` set-state-in-effect error + `radii` warning that exist at HEAD too). NOT RUN on device: map pointing, focus fly, sheet scroll feel, mode switching, OTP box in a fresh release build (rebuild `npx expo run:android --variant release` required — release embeds JS at build time).

## B15 secrets warning

`backend/.env`, `frontend/.env`, and three `.jks` keystores exist in the working folder (gitignored, contents never printed or modified here). If this folder was ever shared, rotate DB, Redis, JWT, MSG91, and Razorpay secrets, and revoke/reissue the upload keystores.
