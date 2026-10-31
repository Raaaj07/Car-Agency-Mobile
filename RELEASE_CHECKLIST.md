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
  `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID`.
- **OTP length (boot blocker):** production refuses to start with `OTP_LENGTH` below 6 unless
  `ALLOW_4_DIGIT_OTP=true`. Set `OTP_LENGTH=6` (current app builds render the server's length); use
  `ALLOW_4_DIGIT_OTP=true` only while old 4-box builds are still in use, then remove it. Make sure the
  MSG91 template accepts the longer code.
- Payments: `PAYMENTS_DEV_MODE=false`; if Razorpay is used: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET` (required in production when dev mode is off).
- Rides: `RIDE_REQUEST_TIMEOUT_SECONDS` (default offer time until an admin saves one),
  `RIDE_MAX_OFFER_ATTEMPTS`, `RIDE_SEARCH_TIMEOUT_SECONDS`, `MAX_TRIP_KM`, optional
  `SERVICE_AREA_BBOX`.
- Drivers: `DRIVER_PRESENCE_GRACE_SECONDS` (default 300 = an ONLINE driver with no new location stays
  visible and is offered rides for 5 minutes; allowed 90-21600; 90 = the old strict behaviour). A live
  app reports every 5-10 s (background task needs "Allow all the time"), so real silence means a dead
  app or phone. A shorter value means fewer ghost offers, a longer one fewer drops for resting drivers
  without the background permission.
- Third parties: `MAPBOX_TOKEN`, `GOOGLE_PLACES_API_KEY` (Places API (New) must be enabled in the
  Google Cloud project or "popular places" stay empty), `GOOGLE_WEB_CLIENT_ID`, `APPLE_CLIENT_ID`,
  Cloudinary keys if `STORAGE_DRIVER=cloudinary`, `ADMIN_PHONES`.
- Optional: `SENTRY_DSN`, `REQUIRE_AUTH_FOR_PHOTOS=true` once old app builds are gone.

Frontend (EAS build env): `EXPO_PUBLIC_API_URL` (ends in `/api/v1`), `EXPO_PUBLIC_MAPBOX_TOKEN`,
`EXPO_PUBLIC_GOOGLE_*` client ids, and the real support contacts `EXPO_PUBLIC_SUPPORT_PHONE` /
`EXPO_PUBLIC_SUPPORT_EMAIL` (Help & support shows no contact without them in a release build; it
only shows placeholders in development), and the legal pages `EXPO_PUBLIC_TERMS_URL` /
`EXPO_PUBLIC_PRIVACY_URL` (the sign-in screen's "Terms" and "Privacy Policy" are plain text without
them; both stores require a working privacy-policy link). These are inlined at build time: treat
as public.

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
   removes them at once; a driver whose app was killed or whose phone died disappears after the
   presence window (`DRIVER_PRESENCE_GRACE_SECONDS`, default 5 min; set it to 120 for a quick test,
   then remove it). Also test a parked driver with GPS off or the phone locked: still visible and
   offered rides inside the window.
7. **Double booking:** two riders book at the same moment with one driver nearby: only one gets the
   offer.
8. **Payment:** UPI QR on the driver phone, "Amount Received" sets the payment status; admin dispute
   resolution works.
9. **Outage:** with Redis down, the backend log shows one error then one line per 30 s, then a
   "recovered" line (not a line every 2 s).
10. **Waiting ride:** book with nobody online, bring the driver online within about 60 s: the offer
    should arrive within a few seconds (the waiting-rides sweep runs every 3 s); accept and the rider
    moves on. With nobody coming, the ride cancels after the search window (about 90 s); after an
    offer was made and declined, the window starts again.
11. **Driver dashboard retry:** start the driver app with the network off: the card "Couldn't load
    your driver profile" shows with "Try again"; turn the network on and tap it (or reopen the app):
    the switch becomes usable without restarting.

### Known product gaps to decide before release

- **Voice announcements** (Profile > Ride preferences / Home bell > Audio Announcements): built with
  `expo-speech` (text-to-speech on the phone). `expo-speech` is already in `frontend/package.json`; the
  app needs a NEW native build (a JS-only update cannot add it; an older build shows "Voice is not
  available" on "Play sample"). Before that build run `cd frontend && npx expo install expo-location
  expo-notifications` (`expo-doctor` reports them two patch versions behind), then retest background
  location and push. Spoken: rider = driver found, driver arriving, trip started, trip finished with the fare,
  cancelled / no drivers; driver = new ride request, ride cancelled, over-speed warning (80 km/h, one fixed
  limit, there is no road speed-limit data). English, Tamil, Hindi: Tamil / Hindi are spoken only if the phone
  has that voice installed, otherwise English. It plays while the app is open (not guaranteed when the app is
  in the background or the phone is locked). There are no spoken turn-by-turn directions: drivers navigate
  in Google Maps. Test on a real phone in each language.
- **Fares: no flat toll and no flat taxes** (owner decision, backend `fare-catalog.ts` `computeFareBreakdown`
  and `frontend/src/utils/fare.ts`): the rider pays the trip price (50% base + 30% distance + 20% time) minus
  any promo. Fares are lower than before (for example a 5 km sedan trip: Rs 240, was Rs 284) and the trip
  price rates are unchanged. Deploy the backend and the app build together, because the app's estimate must
  match the server's fare. Rides booked earlier keep their stored amounts. If tax (GST) must be shown to
  riders, that needs a decision and a change in both files.
- **Choose a Ride arrival times** come from drivers online near the pickup: test with and without
  drivers online ("No drivers nearby right now" must not block booking).

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
