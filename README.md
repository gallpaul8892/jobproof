# JobProof

Painters and decorators photograph finished jobs and submit completion reports. Head-office
managers review those reports and the photo evidence in a web app, and use them to bill
customers. Customers will later pay by Stripe link.

**Phase 1 (this build):** the Manager persona, read-only, with realistic mock data
(Bristol and Bath painting jobs). Sign in, see the dashboard, browse and filter job reports,
inspect photo evidence, and review billing.

## Run it locally (Docker)

Prerequisites: Docker with the Compose plugin, and `make`.

```
make up
```

Then open http://localhost:8080 and sign in with the manager demo account:

| Role | Email | Password |
|---|---|---|
| Manager | `manager@jobproof.test` | `Manager123!` |
| Painter (shows the "managers only" page) | `painter@jobproof.test` | `Painter123!` |

The login page also lists these accounts. Other URLs:

- API: http://localhost:8000 (health: http://localhost:8000/health)
- The API contract is [api/openapi.yaml](api/openapi.yaml)

Other commands: `make down`, `make logs`, `make seed` (reset the mock data), `make lint`,
`make test`, `make e2e`.

The first `make up` builds images and needs internet to download packages and base images.
After that the stack runs fully offline.

## Run it without Docker

Needs Python 3.13 with uv, Node 22, and a PostgreSQL 16 server install.

```
scripts/dev.sh up --static     # Postgres, migrate, seed, backend (8000), web (8080)
scripts/dev.sh status
scripts/dev.sh e2e             # Playwright against the running stack
scripts/dev.sh down
```

Browser tests use Chrome. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if it is not on your PATH.

## GitHub Pages demos (mocked, no backend)

One static site with three parts, all running entirely in the browser from committed fake data:

| Path | What |
| --- | --- |
| `/jobproof/` | Landing page: choose between the two demos (`pages/landing`) |
| `/jobproof/web/` | Manager and Admin web app. A mock API (`web/src/mock`) answers every call from `web/src/mock/mockData.json` |
| `/jobproof/mobile/` | The Operative mobile app (Expo, `expo export --platform web` with react-native-web) in a phone-sized frame |

Every part says "Demo with sample data. Nothing is saved." and links back to the landing page. Nothing is sent
anywhere and nothing is stored: state resets on page reload.

**Web demo.** Writes (mark reviewed, edit notes, customer details, settings) work in memory, keep the version
checks and the 409 "Apply my changes on top" flow. Sign in with the demo accounts shown on the login page.

**Mobile demo.** Three demo operatives can sign in, each with only their own jobs for "today" and earlier unfinished
ones (another operative's job is a 404, as on the real server):

| Operative | Email | Password |
| --- | --- | --- |
| Dan Hughes | `painter@jobproof.test` | `Painter123!` |
| Priya Shah | `priya.shah@jobproof.test` | `Painter123!` |
| Tom Bennett | `tom.bennett@jobproof.test` | `Painter123!` |

A "Demo logins" panel beside the phone (collapsed above it on narrow screens) lists them, and its "Use this login"
button fills the app's sign-in fields (the frame sets the inputs and fires input events; app code is untouched).
The landing page card lists the same logins. Dan's password is the one the real seed already publishes. Priya and
Tom have no password in the real seed (they cannot log in to a real deployment); `Painter123!` for them exists
only in the demo data export (`DEMO_PASSWORD` in `scripts/export-operative-mock-data.py`). Any other email or a
wrong password gets the same 401.
The app's own screens run unchanged: today's jobs, job detail, camera and gallery import, settings and sign-out.
The browser stand-ins live in `mobile/demo` and are swapped in by `mobile/metro.config.js` only when
`JOBPROOF_DEMO=1` and the platform is web, so the Android build is untouched:

- API: `demo/mock` answers the operative endpoints the app calls today (device sessions create, refresh and end,
  app status, branding, job list and detail, draft report save). Dates shift so the data's "today" is the visitor's
  today. Photo upload and report submit do not exist on the server yet (T-003g, T-003h), so the demo does not pretend:
  photos are saved on the "phone" and the app shows its own "not sent" states (for example when signing out).
- Local database: `demo/memoryDb.ts` implements the app's `LocalDb` in memory (parity-tested against SQLite);
  `demo/shims/openStore.ts` replaces `src/db/openStore.ts` with it, in-memory files and a canvas image resizer.
- `expo-sqlite/kv-store` and `expo-secure-store`: in-memory stand-ins. `expo-camera`: a fake camera whose shutter
  "takes" a generated placeholder JPEG; no real camera or microphone is ever requested. The photo picker is a short
  list of generated sample pictures.
- Not possible in a browser, so shown plainly instead: the phone's maps and dialler links, the system photo picker,
  and real photos.

Build and preview locally (needs `npm ci`; the first mobile export takes about a minute):

```
npm run build:pages            # builds pages-dist/ for the base path /jobproof/ (PAGES_BASE=/ to serve from the root)
npm run preview:pages          # serves it like GitHub Pages: http://127.0.0.1:8090/jobproof/
```

- Web demo alone: `VITE_BASE=/jobproof/web/ npm run build:pages -w @jobproof/web && npm run preview:pages -w @jobproof/web`.
- Refresh the data (the demos treat the export date as "today"): `cd backend && uv run python ../scripts/export-mock-data.py`
  for the web demo and `uv run python ../scripts/export-operative-mock-data.py` for the mobile demo
  (`--check` says whether the committed file is current).
- Normal builds contain none of the demo code: `npm run build -w @jobproof/web` fails if the web bundle has mock code
  (`web/scripts/check-dist.mjs`); CI runs `node mobile/demo/checkDemoBundle.mjs --normal mobile/dist` on the Android
  bundle, and `build:pages` runs `--demo` on the browser bundle (also: no external origins).
- Deploy: `.github/workflows/pages.yml` publishes on pushes to `main` that touch `web/`, `mobile/`, `shared/`, `api/`,
  `pages/` or the build script, and on manual run. The repository owner must set **Settings > Pages > Source = GitHub Actions** once.
- Deep links: Pages serves `404.html` for unknown paths; it loads the right app in place, so refreshing
  `/jobproof/web/reports/...` or `/jobproof/mobile/jobs/...` works.
- Visibility: Pages on a private repository needs a paid GitHub plan (otherwise the repository or the site
  must become public). On Enterprise Cloud the site can be restricted to members only if access control is
  enabled; otherwise it is reachable by anyone with the URL even when the repository is private. Everything in
  the demos is fake, and it must stay that way: do not put real customer data or real credentials in `mockData.json`
  or `operativeData.json`.

## Create the first administrator

The Admin account is not part of the seed in staging or production. Create it once, with the
backend environment configured (`DATABASE_URL`, `APP_ENV`):

```
cd backend
ADMIN_INITIAL_PASSWORD='a long passphrase' \
  uv run python -m app.cli create-admin --email admin@example.com --full-name "Ada Admin"
```

Without `ADMIN_INITIAL_PASSWORD` it asks for the password twice, without echoing it. The password
needs 12 to 200 characters. The full name is 1 to 100 characters and follows the company-name
rule: no control, zero-width or bidirectional formatting characters. The command refuses an email
that already exists and prints only the new user's id (never the email or password). It works in
every `APP_ENV`.

## Where things are

| Path | What |
|---|---|
| `backend/` | FastAPI service, Alembic migrations, seed data |
| `web/` | React + TypeScript manager app |
| `shared/` | Generated API client and shared hooks (also for the future mobile app) |
| `e2e/` | Playwright end-to-end tests |
| `api/` | OpenAPI contract |
| `ARCHITECTURE.md` | System design, decisions and versions |
| `specs/`, `tickets/` | Specs and Given/When/Then tickets |
| `.claude/agents/` | The agent team definitions |
| `progress.html` | Build progress page, regenerated by `scripts/progress.py` |

## Before you rely on it

- The Docker images and `docker compose up` were written and validated (`docker compose config`)
  but not run during the build, because the build environment had no Docker daemon. Everything
  else (backend, database, web, tests) ran on the no-Docker path. If `make up` fails, the
  Dockerfiles or compose file are the first place to look.
- Pin the Docker base image tags (search for `TODO(pin)`) on a machine with registry access.
- Run `pip-audit` on a machine with internet access; it could not run offline.
- The seed refuses to run unless `APP_ENV` is `local` or `test`. Demo accounts and secrets in
  `.env.example` are for local use only; the backend refuses to start in other environments
  with the development secrets.

## Next phases

Painter mobile app (Expo), customer payment links (Stripe), quotes and deposits, AWS deployment
(ECS Fargate, RDS, S3 and CloudFront with Terraform), and a weekly dependency check.
