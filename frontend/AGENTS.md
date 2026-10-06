This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx eslint src              # lint (faster equivalent — what verification/CI uses)
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- This repo uses **React Navigation** (NOT Expo Router): `native-stack` + `bottom-tabs` in `src/navigation/*` (`AppNavigator`, `OnboardingNavigator`, `MainTabNavigator`, `RiderHomeStackNavigator`, `DriverDashboardStackNavigator`, `AdminNavigator`, `types.ts`). There is no `src/app/` directory. Do not add Expo Router or migrate anything to it.
- Root gating lives in `AppNavigator`: not authenticated → `Onboarding`; authenticated but `user.profileComplete === false` → `CompleteProfile`; `user.role === 'admin'` → `Admin` console (4 tabs — Overview / Drivers / Rides / Account — each with its own stack; see `screens/admin/*`); otherwise → `Main` (unified Home/Drive/Trips/Profile tabs). Auth state + session restore live in `src/store/authStore.ts` (secure-store tokens, `hydrated` splash). The legacy `authStore.role` field was removed — `user.role` (server truth) is the only role source.
- The Account tab is a stack too (`AdminAccountStackParamList`: `AdminAccount` → `AdminPromos`, the promo-code manager); pushed detail screens are added to the tab's `hideBar` list in `AdminNavigator.tsx` so the floating tab bar hides on them. Admin screens surface API failures with `getApiError(err)` from `src/api/client.ts` and load on mount with promise-callback chains (`.then/.catch/.finally` inside `useEffect`) — a direct `setState` in an effect body trips `react-hooks/set-state-in-effect`.
- Param lists for every stack live in `src/navigation/types.ts` (rider, driver, admin). Keep them in sync when adding screens.
- Docs: https://reactnavigation.org/docs/getting-started/

## Driver background location (D-4)

- The driver heartbeat has two layers: a foreground `setInterval` (drives UI + API) and an OS-level background task in `src/lib/locationTask.ts`
  (`Location.startLocationUpdatesAsync` + `expo-task-manager`, registered globally from `App.tsx`). The task PATCHes `/drivers/location` using SecureStore
  tokens and refreshes them once on 401; `api/client.ts` adopts SecureStore tokens before its own refresh (refresh tokens are single-use).
- `app.json` configures this via the `expo-location` plugin (`isIosBackgroundLocationEnabled`, `isAndroidBackgroundLocationEnabled`, `isAndroidForegroundServiceEnabled`).
  These are **native** changes: they need a dev/EAS build — not testable in Expo Go on Android (no TaskManager there; calls degrade to no-ops).

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
