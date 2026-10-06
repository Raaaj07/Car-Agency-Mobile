# Vazhi Backend

NestJS + TypeScript backend for the Vazhi ride-hailing app. Built to match
`frontend/`'s existing screens and Zustand stores field-for-field — see
`src/common/frontend-contracts.ts` for the shared `VehicleOption`,
`FareBreakdown`, `DriverInfo`, and `User` shapes.

## Stack

- **NestJS** (TypeScript, strict mode)
- **PostgreSQL + PostGIS** via TypeORM (driver locations, geo queries)
- **Redis** for OTP storage, live driver geo-index (GEOSEARCH), and caching
- **Socket.IO** gateway for real-time ride/driver events
- **class-validator / class-transformer** for request DTOs
- **Passport + JWT** for auth

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Defaults work out of the box for local development (`OTP_DEV_MODE=true`
   logs OTPs to the console instead of sending real SMS;
   `PAYMENTS_DEV_MODE=true` auto-succeeds payments instead of calling
   Razorpay). Fill in `MSG91_*` / `RAZORPAY_*` credentials before flipping
   those flags to `false`.

3. **Start Postgres (with PostGIS) and Redis**

   ```bash
   docker-compose up -d postgres redis
   ```

4. **Run migrations**

   ```bash
   npm run migration:run
   ```

5. **Seed mock drivers**

   ```bash
   npm run seed
   ```

   Creates `SEED_DRIVER_COUNT` (default 40) mock drivers scattered within
   `SEED_SPREAD_KM` of `SEED_CITY_LAT`/`SEED_CITY_LNG` (defaults to Salem,
   Tamil Nadu — edit `.env` to change the city). About 80% are seeded
   online so `GET /drivers/nearby` returns results immediately.
   The seed is **deterministic and idempotent** (per-index `mulberry32`
   plans seeded from `PRNG_SEED`; re-running creates nothing new and never
   modifies existing rows), and it ensures the `ADMIN_PHONES` accounts exist.

6. **Run the app**

   ```bash
   npm run start:dev
   ```

   The API is served under `http://localhost:3000/api/v1` (see
   `API_PREFIX` in `.env`). The Socket.IO gateway is on the same port,
   namespace `/realtime`.

### All-in-one with Docker

`docker-compose up` builds and runs the whole stack (Postgres, Redis, and
the app), running migrations automatically on container start. Run
`npm run seed` locally afterwards (pointed at the containers' exposed
ports) to add mock drivers.

## Project layout

```
src/
  auth/        OTP send/verify, JWT issuance, /auth/me
  drivers/     Driver profile, online/offline, location pings, nearby search, documents
  rides/       Booking, matching, ride lifecycle, Socket.IO gateway, reviews, route distance
  payments/    Razorpay/cash order creation + verification
  promos/      Promo codes — rider endpoints + admin CRUD (DB-backed)
  admin/       Admin console API — overview, audit, applications, rides, users, CSV export
  common/      Shared guards, decorators, filters, frontend-contracts.ts
  config/      Env validation, Redis client, TypeORM datasource
  database/    Migrations + deterministic, idempotent seed script
  test/        Shared FakeRedis test double
```

## Testing

```bash
npx jest                 # unit suite: 128 tests / 12 suites — no DB, Redis or network
npx jest path/to.spec.ts # one file
npx tsc --noEmit         # type-check alongside
```

- **No external dependencies**: repositories are mocked (in-memory rows or query-builder
  chains), Redis is `src/test/fake-redis.ts` (the ioredis subset used by geo/timers/OTP),
  HTTP is stubbed (`RouteDistanceService.routedKm`), sockets are `jest.fn()` gateways.
  Plain `npx jest` never touches a database.
- **Suites**: `otp` (throttle/dev-mode), `timezone` (IST day boundaries), `rides.service`
  (locks, guards, timers), `admin.service` (status machine, audit, users list, CSV export),
  `payments.service` (state machine), `promos.service` (eligibility, CRUD, redemptions),
  `drivers.service`, `geo.service` (ghost sweep), `route-distance.service` (clamp/fallback),
  `seed-data` (determinism/idempotence), `csv` (RFC 4180 + formula guard), and
  `src/e2e/happy-path.spec.ts` — an in-process apply → online → book → accept → OTP →
  complete → pay flow with no sockets or network.
- **Integration tests (real Postgres, real SQL)** are opt-in and excluded from the default run:

  ```bash
  docker compose -f docker-compose.test.yml up -d --wait   # throwaway Postgres :5433 + Redis :6380
  INTEGRATION=1 npm run test:integration                   # PowerShell: $env:INTEGRATION='1'
  docker compose -f docker-compose.test.yml down -v        # reset all state
  ```

  No Docker needed: without `TEST_DB_*` overrides the suite reuses `.env`
  credentials against the local server and creates its own `vazhi_test`
  database (the name never falls back to dev's). 11 tests / 3 suites: promos
  (real unique index, FK `SET NULL` history, transaction-atomic redemptions),
  admin users + CSV (escaped ILIKE, grouped counts, phone-free export), and a
  schema-fidelity check that every entity column exists in the migrated schema.
  Note: on a *brand-new* database the chain still trips over the legacy
  `SyncSchemaDrift1790972060287` migration (finding M-2, see `CHANGES.md`);
  the suite detects it, proves it redundant and works around it —
  `npm run migration:run` outside the suite needs the owner fix first.

## API overview

| Method | Path                              | Screen(s)                                   |
| ------ | ---------------------------------- | -------------------------------------------- |
| POST   | `/auth/otp/send`                   | Mobile Number                                |
| POST   | `/auth/otp/verify`                 | OTP Verification                             |
| POST   | `/auth/refresh`                    | (silent token rotation)                      |
| POST   | `/auth/logout`                     | Profile / Admin log out                      |
| POST   | `/auth/google` / `/auth/apple`      | Sign In (social)                             |
| GET    | `/auth/me`                         | Boot restore (role, profileComplete, driverStatus) |
| POST   | `/drivers/apply`                   | Become a driver (multipart + documents)      |
| GET    | `/drivers/application`             | Profile (application status)                 |
| POST   | `/drivers/register`                | Legacy JSON registration (pending; prefer `/apply`) |
| POST   | `/drivers/status`                  | Driver Dashboard (online toggle, approved only) |
| PATCH  | `/drivers/location`                | Turn-by-Turn Navigation (pings, approved only) |
| GET    | `/drivers/nearby`                  | Vehicle Selection / Finding Driver           |
| POST   | `/rides`                           | Ride Details -> Book                         |
| GET    | `/rides`                           | My Rides                                     |
| GET    | `/rides/:id`                       | Trip Progress / Ride Completed               |
| PATCH  | `/rides/:id/accept`                | Ride Request Nearby (Accept)                 |
| PATCH  | `/rides/:id/decline`               | Ride Request Nearby (Decline / 15s timeout)  |
| PATCH  | `/rides/:id/en-route`              | Turn-by-Turn Navigation (starts driving)     |
| PATCH  | `/rides/:id/start`                 | Driver En Route ("Driver Arrived")           |
| PATCH  | `/rides/:id/verify-pickup-otp`     | Driver's OTP entry -> Trip Progress starts   |
| PATCH  | `/rides/:id/complete`              | Trip Progress -> Payment / Ride Completed    |
| PATCH  | `/rides/:id/cancel`                | Cancel Ride Confirmation                     |
| PATCH  | `/rides/:id/review`                | Review Ride                                  |
| POST   | `/payments/create-order`           | Payment & Fare Breakdown                     |
| POST   | `/payments/verify`                 | Payment & Fare Breakdown                     |
| GET    | `/promos/active`                   | Ride Details (promos the rider can use)      |
| POST   | `/promos/validate`                 | Ride Details (apply a code)                  |

| GET    | `/admin/overview`                  | Admin Overview (counts, attention, activity) |
| GET    | `/admin/audit`                     | Admin Overview "Recent activity"             |
| GET    | `/admin/driver-applications`       | Admin Applications list (status filter, paginated) |
| GET    | `/admin/driver-applications/:id`    | Admin application detail                 |
| POST   | `/admin/driver-applications/:id/approve` | Admin approve                      |
| POST   | `/admin/driver-applications/:id/reject`  | Admin reject (reason 5–300 chars)  |
| POST   | `/admin/drivers/:id/suspend`       | Admin suspend (forces offline)           |
| GET    | `/admin/files/:applicationId/:kind` | Admin document image (base64 JSON; `?raw=1` for bytes) |
| GET    | `/admin/rides`                     | Admin Rides list (status/payment/date/search filters) |
| GET    | `/admin/rides/export.csv`          | Admin Rides CSV export (same filters; declared before `/:id`) |
| GET    | `/admin/rides/:id`                 | Admin ride detail (timeline, outlier flag) |
| POST   | `/admin/rides/:id/cancel` / `/payment` | Admin ride actions (audited)          |
| GET    | `/admin/users`                     | User management list (name/phone/email search, role filter) |
| GET/POST | `/admin/promos`                  | Promo codes: list / create (409 on dup code) |
| PATCH/DELETE | `/admin/promos/:id`            | Promo codes: edit / delete (history kept)   |

Socket.IO events (namespace `/realtime`, JWT via `auth: { token }`):
`driver:location`, `ride:request`, `ride:status`, `driver:status` (reject/suspend → app returns to Rider mode), plus client-emitted
`ride:join` / `ride:leave` (membership-verified) to scope location updates to one trip at a time.

## Environment variables (names only)

New in this change: `ADMIN_PHONES` (comma-separated 10-digit seed list for the first admins — never a public endpoint; promotion runs at server start and again at OTP login so late sign-ups are covered), `UPLOAD_DIR` (document storage root, default `<server-cwd>/uploads/`), `MAX_UPLOAD_MB` (per-file cap, default 5), `DB_SSL_REJECT_UNAUTHORIZED` (TLS verification for Postgres), `CORS_ORIGIN` (now enforced on HTTP and the gateway; `*` is rejected in production).
Follow-up pass: `TIMER_SWEEP_MS` (Redis ride-timer sweep interval, default 5000), `PRNG_SEED` (deterministic dev seed; defaults are safe).
Boot refuses to start when `NODE_ENV=production` with `OTP_DEV_MODE=true`, `PAYMENTS_DEV_MODE=true`, or `DB_SYNCHRONIZE=true`.

## Document storage note

Local disk (`backend/uploads/`, git-ignored) is lost on ephemeral hosts (Docker without a volume, many PaaS). Swap `StorageService` for S3/R2-compatible storage before production.

## Notes on design choices

- **Ride status machine**: `requested -> matched -> driver_en_route ->
  in_progress -> completed` (or `cancelled` from any non-terminal state).
  `accept` generates the 4-digit pickup OTP shown on
  `YouGotTheRideScreen`; `verify-pickup-otp` is what actually flips the
  ride into `in_progress`.
- **Fare calculation**: `src/rides/fare-catalog.ts` mirrors the exact
  per-vehicle base prices hardcoded in `VehicleSelectionScreen`, scaled by
  real trip distance (haversine at booking time, PostGIS/driver-reported
  distance at completion) and split 50/30/10 + fixed toll/tax — the same
  ratios `rideStore.getFareBreakdown()` uses on the frontend.
- **Matching**: `GET /drivers/nearby` tries Redis `GEOSEARCH` first (fast,
  in-memory) and falls back to a PostGIS `ST_DWithin` query if Redis has no
  data for that vehicle type yet.
