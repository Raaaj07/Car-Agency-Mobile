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
  drivers/     Driver profile, online/offline, location pings, nearby search
  rides/       Booking, matching, ride lifecycle, Socket.IO gateway, reviews
  payments/    Razorpay/cash order creation + verification
  common/      Shared guards, decorators, filters, frontend-contracts.ts
  config/      Env validation, Redis client, TypeORM datasource
  database/    Migrations + seed script
```

## API overview

| Method | Path                              | Screen(s)                                   |
| ------ | ---------------------------------- | -------------------------------------------- |
| POST   | `/auth/otp/send`                   | Mobile Number                                |
| POST   | `/auth/otp/verify`                 | OTP Verification                             |
| GET    | `/auth/me`                         | (any authenticated screen)                   |
| POST   | `/drivers/register`                | (driver onboarding, before Dashboard)        |
| POST   | `/drivers/status`                  | Driver Dashboard (online toggle)             |
| PATCH  | `/drivers/location`                | Turn-by-Turn Navigation (pings)              |
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

Socket.IO events (namespace `/realtime`, JWT via `auth: { token }`):
`driver:location`, `ride:request`, `ride:status`, plus client-emitted
`ride:join` / `ride:leave` to scope location updates to one trip at a time.

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
