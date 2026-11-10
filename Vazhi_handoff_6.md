# Vazhi ride-hailing app: handoff 6 (continues Vazhi_handoff.md, _2, _3, _4 and _5)

Owner: Vijay. Project folder: `D:\Projects\CarAgencyMobile` (frontend + backend). Branch: `fix/local-changes`.
Written 10 Nov 2026. "Verified" means Vijay pasted a green result. "Written" means the code is in the folder
but he has not run it. Nothing below has been tried on a real phone.
Claude edits files through the filesystem connector (allowed directory: the project folder) and cannot run
commands. Vijay runs tsc / jest / eslint and pastes the results back.
Connector notes: no grep (`search_files` matches file NAMES only), so to find a string read the likely files.
The connector's tools sometimes drop for a whole turn, or a tool call waits for an approval prompt in Claude
Desktop; say so and retry once, never pretend an edit was made. Re-read a file after editing when unsure.

---

## 1. What the project is (unchanged)

Ride-hailing app for Salem / Erode (Tamil Nadu): rider, driver and admin in one Expo app.
- `frontend/`: Expo SDK 57, React Native, `@rnmapbox/maps`, React Navigation, Zustand, axios, socket.io-client, expo-speech.
- `backend/`: NestJS 11 (Express 5), TypeORM + PostgreSQL (Supabase), Redis, Socket.IO (`/realtime`), Jest.
- Ride flow: book -> match nearest free driver one at a time (offer timeout from Redis timers; a sweep every 3 s
  offers rides still waiting) -> accept -> en route -> pickup OTP -> in progress -> completed -> review -> UPI QR
  paid on the driver's phone ("Amount Received"). Admin cancels rides, resolves disputed payments, sees an audit log.

---

## 2. Last verified state

- Backend: `tsc` clean, **39 suites / 506 tests pass** (pasted 10 Nov 2026, 11:58).
- Frontend: `tsc` clean, `eslint` clean, tests green (Vijay confirmed "green" but did not paste the counts;
  expected **17 suites / 132 tests**: `announcements`, `announcementPrefs`, `heartbeat`, `fare`, `vehicleEta`,
  `vehicle`, `tripTime`, `cancellation`, `paymentState`, `distance`, `format`, `upi`, `resumeTarget`,
  `rideTransition`, `promo`, `dateInput`, `savedPlaces`).
- Git: run `git status` and commit if anything is uncommitted (everything in section 3 should be committed once
  Vijay did so; I did not see the commit).

---

## 3. What was done since handoff 5 (all green in tests, none on a phone)

### 3.1 Five open items from the handoff-5 review
- **PostGIS only when Redis cannot answer.** `GeoService.searchNearby` returns `[]` when Redis answered and nobody
  is there, and `null` only when Redis could not answer (down, timeout, no GEOSEARCH); GEOSEARCH failures are
  logged at most once per 30 s. `DriversService.findNearby` falls back to PostGIS only on `null`. Before, every
  rider poll and the 3 s waiting-rides sweep hit the database whenever nobody was online.
- **Arrival times per vehicle type ("Choose a ride").** With no vehicle type, `findNearby` uses the new
  `GeoService.searchNearbyPerType` (nearest 5 of EACH type, merged nearest-first, one GEOSEARCH per type), so a type
  is no longer shown as "No drivers nearby right now" because 20 nearer drivers of another type filled the list.
- **Search window from booking.** `RidesService.searchWindowRemainingMs`: when no driver is left to offer, the
  search timer is armed with what remains of the window since `createdAt` (at least 1 s), not a fresh 90 s after
  every declined / expired offer. A window already used up cancels on the next sweep.
- **No "Your ride was cancelled" after cancelling yourself.** `cancelledBy` is on `Ride` / `ActiveRide` and in the
  announcement snapshot; a cancel by the rider is silent, by the driver / admin / system (incl. "no drivers") is announced.
- **Admin review fixes:** radius and offer-time cards no longer show an invented value (10 km / 15 s) when loading
  failed; Overview pull-to-refresh and retry refresh the Drivers-tab badge; editing a promo showed the day BEFORE
  its start date and moved it a day earlier on every save (`utils/dateInput.ts`, `isoToLocalDay`).

### 3.2 Promo codes in the rider app
- Riders had NO way to enter a code (the old promo carousel was gone; `rideStore.applyPromoCode` only knew the
  hard-coded `VAZHI20`), so codes created in the admin console could never be used.
- `RideDetailsScreen` (Ride Summary) now has a PROMO CODE card: type a code + Apply, or tap one of the offers from
  `GET /promos/active`; the amount comes from `POST /promos/validate` (the booking checks it again; validate is
  throttled to 10/min); a remove (x) clears it. New store action `setPromo(code, amount)`; `applyPromoCode` is
  deprecated and unused. Rules in `utils/promo.ts` (+ tests). The card is wrapped in a `KeyboardAvoidingView`.

### 3.3 Admin leftovers
- **"Online drivers" card matches its list:** `GET /admin/driver-applications?online=true`
  (`ListApplicationsQueryDto.online`, `AdminService.listApplications` opts), "Online now" chip on the Active list,
  the Overview card opens it switched on (`AdminDrivers` route param `online`). 2 backend tests.
- Ride detail: an alert when the reload after cancel / payment update fails; "Mark disputed" hidden on a ride
  already disputed. Driver detail: the silent refresh of an expiring document link no longer blanks the viewer, and
  a refresh finishing after the viewer closed does nothing. Rides list: "Custom" without Apply shows a "Choose a
  date range" prompt instead of every ride. Promo form (admin): keyboard avoidance on iOS (unverified on a phone).

### 3.4 Home / Work shortcuts on the rider home screen
- Bug: the Home and Work buttons were not on the rider home screen at all (they only existed on the "change pickup"
  search screen `DestinationSearchScreen`) and the logic had gaps.
- New `components/home/HomeWorkRow.tsx`: two chips under the search box (and in the inline search while nothing is
  typed). Tap a saved one = book to it; "Add Home" / "Add Work" = save mode (banner "Search for your Home address" +
  Cancel; the next place picked is saved instead of booked; "Home saved" note clears after 3 s); press and hold a
  saved one = change it. Logic is in `HomeDashboardScreen` (`savingLabel`, `saveAsHomeWork`, `startSaving`,
  `handleShortcutPress`); the sheet height reserves room for the row (`SHORTCUT_ROW_HEIGHT`).
- `placesStore.setHomeWork` now returns whether the server stored it (before it swallowed failures) and no longer
  leaves a duplicate when the place was already saved (hearted).
- The server keeps ONE row per place (lat/lng rounded to 4 decimals) and one Home + one Work, so a place that is
  already the OTHER shortcut is refused ("That place is already your Home"), on both screens. Rules in
  `utils/savedPlaces.ts` (`placeKey`, `savedForLabel`, `conflictingLabel`, `labelName`) + 7 tests.

### 3.5 Still true from handoff 5 (not repeated here)
Presence window default 5 min (`DRIVER_PRESENCE_GRACE_SECONDS=300`), driver dashboard retry card, OTP boot blocker
(`OTP_LENGTH=6` or `ALLOW_4_DIGIT_OTP=true` in production), fares without flat toll/taxes, voice announcements
(needs `expo-speech` + a NEW native build), waiting-rides sweep every 3 s, parked-driver keepalive heartbeat.
`CHANGES.md` has a section for every item above (newest first).

---

## 4. What to do now

1. `git status`, commit.
2. **Real-phone tests** (none done yet; `RELEASE_CHECKLIST.md` section 4 has the long list):
   - Home / Work: Add Home, tap Home, press and hold to change, same place for Home and Work refused, airplane mode
     shows "Could not save", same on the "change pickup" screen.
   - Promo: create `FESTIVE50` in admin, apply on the ride summary, fare drops by 50, receipt shows it; used first-ride
     or expired code shows the server's message.
   - Book with nobody online, bring a driver online within about 60 s: offered in 3-7 s; with nobody coming the ride
     still cancels about 90 s after BOOKING (also after declined offers).
   - Parked driver (GPS off / phone locked, set `DRIVER_PRESENCE_GRACE_SECONDS=120` temporarily): stays visible,
     then drops.
   - "Choose a ride" shows an arrival time for every type that has a driver; voice in English / Tamil / Hindi
     ("Play sample" first); no voice after cancelling yourself; fares list = summary = receipt; cold-start resume.
   - Admin: "Online drivers" card and list match; "Custom" dates; promo edit keeps the start date.
3. **Release prep:** `OTP_LENGTH=6`, the three migrations (`1791900000000-AddAppSettings`,
   `1792000000000-AddActiveRidePerDriverIndex`, `1792100000000-AddHotPathIndexes`: `cd backend && npm run
   migration:run`), build env values (`EXPO_PUBLIC_SUPPORT_PHONE`, `_SUPPORT_EMAIL`, `_TERMS_URL`, `_PRIVACY_URL`,
   API URL, Mapbox, Google), `cd frontend && npx expo install expo-location expo-notifications` (two patch
   versions behind), then a NEW native build (expo-speech). Deploy backend and app together (fares). Full list in
   `RELEASE_CHECKLIST.md`.

---

## 5. Known risks and open items

- **Redis healthy but empty now means "nobody online".** If Redis is flushed / restarted, riders see no drivers and
  waiting rides wait until the drivers' next pings repopulate it (5-10 s); PostGIS is used only when Redis errors.
- A ride that was offered to several drivers now cancels sooner (90 s after booking, not 90 s after the last decline).
- The all-types nearby search is 4 Redis calls (one per vehicle type) per rider poll.
- Home / Work: one place cannot be both (server model). If the saved places failed to load, "Add Home" shows even when
  a Home exists and saving would replace it (the app loads them silently on launch).
- Promo: the discount is a fixed amount from the server; only codes the rider is eligible for are offered.
- Voice: plays only while the app is open; Tamil and Hindi sentences need a native-speaker check; the over-speed
  limit is one fixed 80 km/h; no spoken turn-by-turn directions.
- Presence window default 5 min: a driver backgrounded WITHOUT "Allow all the time" can drop after 5 min; a crashed
  app can look online for up to 5 min.
- Driver offer countdown is a local count-down (freezes in the background); `ReviewRide` comment box may be covered by
  the keyboard (unverified); driver trip rules `tripTarget` / `tripLabel` are untested.
- `DRIVER_LOCATION_STALE_SECONDS` in `.env.example` / `env.validation.ts` looks unused; `RIDE_MAX_OFFER_ATTEMPTS` is
  not declared in `env.validation.ts` (harmless); `fare-catalog.ts` still carries the old static `badge` fields.
- GST is not charged (a change would touch both fare files). Payments are manual UPI + driver confirmation;
  Razorpay code exists, direction undecided.
- With Redis down offers stop timing out and rate limiting fails open; a free Supabase project pauses when idle.
- Per-instance 15 s cache for the radius and offer time. `npm audit`: 14 accepted build-tool findings; never run
  `npm audit fix --force` (installs `expo@51`).
- Claude never read `.env` files or `.jks` keystores.

---

## 6. Decisions still open (ask Vijay)

- Keep the lower fares, or raise the per-km rates to keep earnings the same?
- Should GST be shown / charged to riders?
- Is a 5-minute presence window right (longer = fewer drops for resting drivers, more ghost drivers)?
- Payments direction (manual UPI vs Razorpay).

---

## 7. How to continue in a new chat

Attach the filesystem connector for `D:\Projects\CarAgencyMobile` and paste the handoff files (this one first), then:

```
I'm Vijay, continuing Vazhi (D:\Projects\CarAgencyMobile, branch fix/local-changes). Read Vazhi_handoff_6.md first
(then _5, _4, _3, _2 and the first handoff for background). Don't change anything yet: confirm in a few lines what is
done and what is next. Then start with section 4 (I will paste my tsc / eslint / jest results and phone-test results).
For each step: plan in 3-5 lines, edit the files through the connector, then give me the exact commands to run
(backend: npx tsc --noEmit, npm test; frontend: npx tsc --noEmit, npx eslint src, npm test). I run them and paste
results back. Keep answers short and plain.
```
