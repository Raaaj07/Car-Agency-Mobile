# Vazhi — Car Agency Mobile

Ride-hailing platform for riders, drivers and an admin console, in one repository.

| Area | Stack |
| --- | --- |
| `backend/` | NestJS 11, TypeORM + PostGIS, Redis (geo, cache, timers, throttling), Socket.IO, Razorpay, Cloudinary |
| `frontend/` | Expo SDK 57, React Native 0.86, React 19, React Navigation 7, Zustand, Mapbox |

## Repository layout

```
backend/    NestJS API (src/<domain>/: auth, rides, drivers, payments, promos, admin, settings, ...)
frontend/   Expo app (src/api, src/store, src/screens/{rider,driver,admin,onboarding}, src/lib)
.github/    CI (lint, typecheck, unit, fresh-DB integration) + secret guard
ADMIN.md    Owner/admin runbook: access, migrations, env names, security checklist
AUDIT.md    Historical audit: flows traced, bugs, fixed/open findings
CHANGES.md  Delivery log (one row per change/pass)
RUNBOOK.md  Deploy / rollback / incident procedures
```

## Quick start

Node 22 LTS is the supported runtime (CI uses it).

### Backend

```bash
cd backend
cp .env.example .env        # fill in names from ADMIN.md; never commit .env
docker compose up -d        # Postgres + PostGIS + Redis
npm ci
npm run migration:run       # migrations are manual, never automatic
npm run seed                # optional dev seed
npm run start:dev
```

Checks (no database needed):

```bash
cd backend
npx tsc --noEmit
npm test                    # unit suite
npm run lint
```

Integration suite (real Postgres, opt-in):

```bash
cd backend
docker compose -f docker-compose.test.yml up -d --wait
INTEGRATION=1 npm run test:integration     # PowerShell: $env:INTEGRATION='1'
```

### Frontend

```bash
cd frontend
npm ci
npx expo start             # Expo Go for UI work
npx expo run:android       # native build (background location, Mapbox, push)
```

Checks:

```bash
cd frontend
npx tsc --noEmit
npx eslint src
npm test                   # pure-helper unit tests
npx expo-doctor
```

Release builds require `EXPO_PUBLIC_API_URL` to start with `https://` (the app throws at
module load otherwise); dev builds fall back to the local API URL.

## Security & correctness highlights

- Default-deny auth: a global JWT guard protects every route unless it is explicitly `@Public()`;
  roles are read from the database, never trusted from the token.
- Shared token-claims rules (`auth/token-claims.ts`) are enforced identically by HTTP, the Socket.IO
  handshake and the photo proxy. Revoked refresh sessions close their sockets immediately.
- One active ride per rider **and** per driver, enforced by partial unique indexes; driver offers are
  claimed atomically (`DriversService.claimAvailability`) so two bookings cannot offer the same driver.
- Payments: Razorpay webhooks are signature-verified over the raw body and settle only a signed
  `captured`/`INR` payment whose amount matches the order; mismatches leave an admin-visible audit row.
- Uploads: magic-byte validation, size caps, SSRF-safe photo proxy with a host allowlist.
- Secrets, `.env*` files and signing material are gitignored and enforced by a secret-guard workflow.

## Operational docs

- `ADMIN.md` — admin console access, migrations, environment variable names, owner security checklist.
- `RUNBOOK.md` — deploy, migration, rollback and incident procedures.
- `CHANGES.md` — what changed in each hardening pass.

## CI

`ci.yml` runs, on every PR:

1. backend lint → typecheck → unit tests → dependency audit (non-blocking report),
2. backend integration tests against a **fresh** PostGIS database (proves the migration chain bootstraps),
3. frontend lint → typecheck → unit tests.

`secret-guard.yml` fails if a `.env*` file or keystore is ever tracked.
