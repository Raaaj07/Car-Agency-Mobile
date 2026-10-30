# RELEASE_CHECKLIST — before shipping a Vazhi build

Names only for secrets: this file never contains values. Deploy / rollback / incident steps are in
`RUNBOOK.md`; env variable names are in `backend/.env.example` and `frontend/.env.example`.

---

## 1. Code gate (must all pass)

```
cd backend  && npx tsc --noEmit && npm test
cd frontend && npx tsc --noEmit && npx eslint src && npm test
```

- CI green on the branch (unit, fresh-DB integration, frontend, secrets-guard).
- `cd frontend && npm audit --audit-level=high` reviewed (CI runs it non-blocking; fix what is safe,
  note the rest as build-tool only).
- `git ls-files -- '*.jks' '*.env*'` prints nothing except the `.env.example` files.

## 2. Database migrations (run once, manually, before the new image starts)

```
cd backend && npm run migration:run
```

Added recently (the run applies everything pending, in order):

| Migration | What it does |
|---|---|
| `1791900000000-AddAppSettings` | `app_settings` table (admin driver radius + offer time) |
| `1792000000000-AddActiveRidePerDriverIndex` | `UQ_rides_active_per_driver`; cancels legacy duplicate active rides first |
| `1792100000000-AddHotPathIndexes` | indexes on rides and refresh sessions |

Run it before the new image starts, even though the settings service falls back to defaults
(radius 10 km, offer time from env) when it cannot read the table: the boot-time schema check can
refuse to start production until migrations are applied, and the admin cards would only show
defaults until then.

## 3. Environment (production)

Backend, set in the host (Render etc.):
- Core: `NODE_ENV=production`, `PORT`, `API_PREFIX`, `CORS_ORIGIN`, `PUBLIC_API_URL`,
  `TRUST_PROXY=true` behind a proxy.
- Database: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `DB_SSL=true`,
  `DB_SYNCHRONIZE=false`.
- Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS`. Without Redis, offers stop
  timing out and rate limiting fails open.
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (32+ chars), `OTP_DEV_MODE=false`,
  `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID`, `OTP_LENGTH` (see the note in
  `.env.example` before changing it).
- Payments: `PAYMENTS_DEV_MODE=false`; if Razorpay is used: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET` (required in production when dev mode is off).
- Rides: `RIDE_REQUEST_TIMEOUT_SECONDS` (default offer time until an admin saves one),
  `RIDE_MAX_OFFER_ATTEMPTS`, `RIDE_SEARCH_TIMEOUT_SECONDS`, `MAX_TRIP_KM`, optional
  `SERVICE_AREA_BBOX`.
- Third parties: `MAPBOX_TOKEN`, `GOOGLE_PLACES_API_KEY` (Places API (New) must be enabled in the
  Google Cloud project or "popular places" stay empty), `GOOGLE_WEB_CLIENT_ID`, `APPLE_CLIENT_ID`,
  Cloudinary keys if `STORAGE_DRIVER=cloudinary`, `ADMIN_PHONES`.
- Optional: `SENTRY_DSN`, `REQUIRE_AUTH_FOR_PHOTOS=true` once old app builds are gone.

Frontend (EAS build env): `EXPO_PUBLIC_API_URL` (ends in `/api/v1`), `EXPO_PUBLIC_MAPBOX_TOKEN`,
`EXPO_PUBLIC_GOOGLE_*` client ids, and the real support contacts `EXPO_PUBLIC_SUPPORT_PHONE` /
`EXPO_PUBLIC_SUPPORT_EMAIL` (Help & support shows no contact without them in a release build; it
only shows placeholders in development). These are inlined at build time: treat as public.

## 4. Real-device tests (2-3 phones: admin, rider, driver)

Never run on real devices yet; the highest-value checks:

1. **Radius:** Admin > Account > Driver search radius changes who sees nearby cars and who gets offers.
2. **Offer time:** set 30 s; book; driver countdown starts at 30; let it expire; next driver gets a
   fresh 30. Changing it mid-offer must not change the offer already out.
3. **Nearest first:** with 2+ drivers, the nearest gets the offer; a timeout moves to the next.
4. **Cold-start resume:** force-close the rider app in each state, reopen, expect the right screen:
   searching, driver assigned, driver on the way, trip in progress, finished-but-unrated (review).
5. **Background resume:** rider app in the background while the driver completes, then while the
   driver cancels; foreground the rider: it must move to review / the cancelled screen with no stuck
   "Searching" or map.
6. **Driver background:** online driver, app backgrounded: stays visible while online; going offline
   or closing removes them within about 90 s; no ghost driver after the app is killed.
7. **Double booking:** two riders book at the same moment with one driver nearby: only one gets the
   offer.
8. **Payment:** UPI QR on the driver phone, "Amount Received" sets the payment status; admin dispute
   resolution works.
9. **Outage:** with Redis down, the backend log shows one error then one line per 30 s, then a
   "recovered" line (not a line every 2 s).

### Known product gap to decide before release

- **Audio Announcements** (opened from the Home bell icon) keeps its switches in memory only and its
  "Save Audio Preferences" button just closes the screen: nothing is saved or used. Either wire it up,
  hide the bell, or mark the screen as coming soon.

## 5. Store listing / permissions

Android and iOS background location (drivers only) is the review risk. Wording to use:

- In-app disclosure shown before the permission prompt (suggested): "Vazhi uses your location in
  the background while you are online as a driver, so riders can see your car on the map and your
  trip can be tracked. It stops when you go offline."
- Play Console declaration: foreground service (location) and background location are used only for
  driver mode, to share live trip position while the driver is online.
- `frontend/app.json` already sets `isAndroidBackgroundLocationEnabled`, the foreground service and
  the iOS `NSLocationAlwaysAndWhenInUseUsageDescription`. Note the iOS "Always" text exists twice
  (the `infoPlist` string and the `expo-location` plugin string, which differ). Make them say the
  same thing, driver-focused, before submitting.
- Camera and photo library strings cover profile photo and driver documents (already set).
- Account deletion exists in-app (Profile > Delete account): link it in the store listing.

## 6. What to watch after release

- `/health` (`postgres`, `redis` both `up`), Redis reconnect lines in the log.
- Log lines `Timer sweep failed`, `Timer sweep still failing`, `Timer sweep recovered`.
- Rides stuck in `requested` (Admin > Overview), offer-to-accept rate, `no_drivers_available`
  cancellations.
- Admin audit log: `settings_update` rows (who changed the radius or offer time, from what to what),
  `payment_mismatch` rows.
- Socket handshake rejections (`Session ended`), OTP send failures, p95 latency.

## 7. Rollback

Redeploy the previous image tag. Migrations above are additive. If the unique index
`UQ_rides_active_per_driver` ever blocks a legitimate flow, roll forward with a new migration rather
than `migration:revert` on live data. See `RUNBOOK.md` section 3.
