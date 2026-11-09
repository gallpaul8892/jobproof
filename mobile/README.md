# mobile (`@jobproof/mobile`)

The Operative app: Expo SDK 58, React Native 0.88, React 19.3.0, Expo Router, Android first.
Design: [specs/T-003-design.md](../specs/T-003-design.md). Current ticket: T-003a (app shell:
branded header, server reachability, no business screens yet).

It uses the same generated API client as the web app through `@jobproof/shared` (public entry
only; ESLint forbids deep imports). Expo Go is not used (later tickets add native modules): use a
development build.

## Configuration

The server address is build configuration, never source. `app.config.ts` reads:

| Variable | Meaning |
|---|---|
| `API_BASE_URL` | Required. API origin, `https` unless `APP_VARIANT=development` |
| `APP_VARIANT` | `development`, `preview`, `screenshots` or `production` (default) |

Locally put them in `mobile/.env.local` (uncommitted; copy `.env.example`). On EAS they come from
the EAS environment of the same name as the build profile (`eas.json` holds no URLs or secrets).
The app reads them at runtime from `expo-constants` (`src/config.ts`).

## Run against the local stack

1. `scripts/dev.sh up` (or `make up`) so the API listens on port 8000.
2. Android emulator: `API_BASE_URL=http://10.0.2.2:8000`. A phone on your LAN:
   `http://<your LAN IP>:8000`. CORS does not apply to native fetch.
3. `npm run android -w @jobproof/mobile` (builds and installs a development build; needs the
   Android SDK), then `npm start -w @jobproof/mobile`.

## Checks (no device needed)

```
npm run lint -w @jobproof/mobile      # eslint + tsc
npm test -w @jobproof/mobile          # Jest: "logic" (node) and "ui" (jest-expo + RNTL 14) projects
npm run export -w @jobproof/mobile    # Metro bundles for Android (needs API_BASE_URL)
npx expo-doctor                       # needs internet (Expo API)
```

Jest also scans the sources: no "painter" wording, no `http(s)://` address literal, no deep
imports into `shared`. `test/singleReact.test.ts` fails if a second React copy appears (the
repo pins `react`/`react-dom` 19.3.0 with a root `overrides`; see T-003a, React alignment).

Not covered here and needing a phone or emulator: install and launch time (T-003a scenario 1),
real Android rendering, the icon (a plain placeholder in `assets/`).
