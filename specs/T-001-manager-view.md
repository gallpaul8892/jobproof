# Spec T-001: Manager can view jobs, evidence and billing (mock data)

Ticket: [tickets/T-001-manager-view.md](../tickets/T-001-manager-view.md). Foundation and
conventions: [specs/T-000-bootstrap.md](T-000-bootstrap.md). Contract:
[api/openapi.yaml](../api/openapi.yaml). Implementation tickets: T-001a to T-001d (end of file).

## Questions

None blocking. Assumptions (product owner may revise):

- A1. All 60 seeded jobs are completed and each has exactly one completion report (scenario 5
  says "60 seeded jobs with reports"). Scheduled and in-progress jobs exist in the model but not
  in the seed.
- A2. "Status" in scenario 6 covers both review status (awaiting review / reviewed) and billing
  status (not invoiced, draft, sent, part paid, overdue, paid, void); the list offers both filters.
- A3. "This month" is the current calendar month in Europe/London. "Jobs completed this month"
  counts jobs by `completed_on`. "Total invoiced this month" sums issued (non-draft, non-void)
  invoice totals with `issue_date` this month. "Total outstanding" is the unpaid balance of all
  issued, non-void invoices. Overdue means past due date with a balance, part-paid included.
- A4. 20% VAT on everything. Payment terms 14 days (homeowners) or 30 days (landlords, businesses).
  A deposit paid on the quote is deducted on the invoice (`deposit_applied_pence`).
- A5. Billing table "amount" is the invoice total (after deposit), "paid" is payments received
  against the invoice; deposits show on the report detail, not in the paid column.
- A6. Roles are exclusive. A painter who signs in to the web app sees a "managers only" page.
- A7. Mock region is Bristol and Bath. Dates in the seed are relative to the seed's anchor date
  (today by default) so the dashboard always has current-month figures.
- A8. A report "awaiting review" is one a manager has not yet reviewed; Phase 1 has no action to
  review it (read-only).
- A9. Session lasts 30 minutes with no refresh; on expiry the manager signs in again.

## Summary

Adds the data model for all three personas (implemented tables only for what T-001 reads), a
deterministic UK mock dataset with generated placeholder photos, JWT login for seeded users, a
manager-only read API (dashboard, reports list and detail, invoices, painters, signed photo
images), and a React web app with login, dashboard, reports, report evidence and billing pages,
each with loading, empty and error states.

## Patterns

- **Strategy** `PhotoStore` (`backend/app/photos/store.py`): `url_for(photo, variant) -> str` and
  `render(photo, variant) -> (bytes, content_type)`. `PlaceholderPhotoStore` now; `S3PhotoStore`
  later returns presigned URLs. Chosen because photo delivery differs per phase/environment and
  callers must not care.
- **Adapter** around the generated client (`shared/src/api/client.ts`), see T-000 spec section 5.
- **Strategy** `TokenStore` (`shared/src/auth/tokenStore.ts`) with web `sessionStorage`
  implementation; mobile SecureStore later.
- No pattern for authorisation (one router-level dependency) or invoice status (pure function).

## Data

Conventions: UUID PKs (`gen_random_uuid()` server default; seed supplies uuid5 values),
`created_at`/`updated_at timestamptz not null default now()`, money `integer` pence with
`CHECK (>= 0)`, `currency char(3) not null default 'GBP' CHECK (currency = 'GBP')`. Postgres enums
named as below. FKs `ON DELETE RESTRICT` unless stated. Migration `0001_initial_schema` creates
the nine Phase 1 tables; sketch tables are created by later migrations, not now.

### Phase 1 tables (implement)

**users**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| email | text not null | stored lowercased; unique index `uq_users_email` |
| full_name | text not null | |
| role | enum `user_role` (manager, painter) not null | |
| phone | text null | |
| password_hash | text null | argon2id; null = cannot sign in |
| is_active | boolean not null default true | |

**customers**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| customer_type | enum `customer_type` (homeowner, landlord, business) | |
| name | text not null | person or company name; index on `lower(name)` |
| contact_name | text null | for landlord/business |
| email, phone | text null | |
| billing_line1, billing_town, billing_postcode | text not null | |
| billing_line2, billing_county | text null | |
| payment_terms_days | smallint not null | 14 or 30; CHECK 0..120 |
| notes | text null | |

**jobs**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| reference | text not null unique | `JP-1001` to `JP-1060`, numbered by `scheduled_start` |
| customer_id | uuid fk customers | index |
| painter_id | uuid fk users null | assigned painter (role painter); index |
| job_type | enum `job_type` (interior_repaint, exterior_repaint, wallpapering, kitchen_cabinet_spray, staircase_woodwork, commercial_unit) | |
| title | text not null | |
| status | enum `job_status` (scheduled, in_progress, completed, cancelled) | |
| site_line1, site_town, site_postcode | text not null | |
| site_line2, site_county | text null | |
| notes | text null | office notes, may be long |
| scheduled_start | date not null | |
| completed_on | date null | CHECK `(status = 'completed') = (completed_on IS NOT NULL)`; index |

**quotes**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| job_id | uuid fk jobs | index (not unique: revised quotes later) |
| reference | text not null unique | `Q-0301`... |
| status | enum `quote_status` (draft, sent, accepted, declined, expired) | |
| subtotal_pence, vat_pence, total_pence | integer not null | CHECK total = subtotal + vat |
| deposit_pence | integer not null default 0 | CHECK deposit <= total |
| currency | char(3) | |
| issued_on | date not null | |
| valid_until | date not null | |
| accepted_on | date null | |

The job's quote for the API is the latest accepted quote, else the latest issued.

**job_reports**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| job_id | uuid fk jobs, unique | one completion report per job |
| painter_id | uuid fk users | the submitter |
| submitted_at | timestamptz not null | index desc |
| painter_notes | text null | |
| review_status | enum `review_status` (awaiting_review, reviewed) | index |
| reviewed_at | timestamptz null | CHECK reviewed iff reviewed_at and reviewed_by_id not null |
| reviewed_by_id | uuid fk users null | |

**report_checklist_items**: id, report_id (fk, `ON DELETE CASCADE`), position smallint,
label text, done boolean, note text null; unique (report_id, position).

**report_photos**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| report_id | uuid fk job_reports, cascade | index (report_id, stage, taken_at) |
| stage | enum `photo_stage` (before, during, after) | |
| position | smallint not null | order within report |
| caption | text not null | |
| taken_at | timestamptz not null | |
| width, height | integer not null | pixels of full image |
| storage_key | text null | null = generated placeholder; S3 key later |
| content_type | text null | set when stored |

**invoices**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| job_id | uuid fk jobs | partial unique index on job_id `WHERE state <> 'void'` |
| customer_id | uuid fk customers | denormalised for billing queries; must equal the job's customer; index |
| number | text not null unique | `INV-0101`..., sequential by issue order, drafts get numbers too |
| state | enum `invoice_state` (draft, issued, void) | stored lifecycle; display status is derived |
| subtotal_pence, vat_pence, deposit_applied_pence, total_pence | integer not null | CHECK total = subtotal + vat - deposit_applied, total > 0 |
| currency | char(3) | |
| issue_date, due_date | date null | CHECK (state = 'draft') = (issue_date IS NULL) and same for due_date; due >= issue; index issue_date |

**payments**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| kind | enum `payment_kind` (deposit, invoice) | |
| quote_id | uuid fk quotes null | set iff kind = deposit |
| invoice_id | uuid fk invoices null | set iff kind = invoice; index |
| amount_pence | integer not null | CHECK > 0 |
| currency | char(3) | |
| method | enum `payment_method` (card, bank_transfer, cash) | |
| received_at | timestamptz not null | |
| provider_ref | text null | Stripe payment intent id later |

CHECK `(kind = 'deposit' AND quote_id IS NOT NULL AND invoice_id IS NULL) OR (kind = 'invoice' AND invoice_id IS NOT NULL AND quote_id IS NULL)`.

### Later tables (sketch only, do not create)

- **invoice_line_items**: invoice_id, position, description, quantity, unit_pence, vat_rate_bp.
- **payment_links**: id, token_hash (unique), invoice_id or quote_id, amount_pence, expires_at,
  used_at, stripe_checkout_session_id. The customer persona's capability, no customer login.
- Painter capture later adds `report_photos.storage_key` uploads (S3, MinIO locally) and
  `job_reports` drafts (`status` draft/submitted); no structural change needed.

### Derived values (`backend/app/services/billing.py`, pure, unit tested)

- `paid_pence` = sum of invoice payments; `balance_pence` = max(total - paid, 0).
- `invoice_status(state, total, paid, due_date, today)`: `void` if state void; `draft` if state
  draft; `paid` if balance 0; `overdue` if due_date < today; `part_paid` if paid > 0; else `sent`.
  `today` is London today from `app.clock`.
- `billing_status(job)` = status of the job's non-void invoice, else of its latest void invoice,
  else `not_invoiced`.

SQL implementations of filters on these values must match the pure function; tests compare the
two across the whole dataset.

## Mock data (seed, deterministic)

`build_dataset(anchor)` with `random.Random(20261107)`; uuid5 ids; reseed truncates and reloads.
"Month m0" is the London month containing `anchor`, m1 the previous month, and so on to m5.

| Entity | Volume and distribution |
|---|---|
| Users | 1 manager **Sarah Whitfield** `manager@jobproof.test` / `Manager123!`; 6 painters, one of which can sign in: **Dan Hughes** `painter@jobproof.test` / `Painter123!`. Others: Priya Shah, Tom Bennett, Gareth Lewis, Kasia Nowak, Liam O'Connor (`firstname.lastname@jobproof.test`, no password). |
| Customers | 12: 8 homeowners (14-day terms), 2 landlords and 2 businesses (30-day terms). Realistic Bristol/Bath names, addresses, `07700 900xxx` phone numbers, `@example.co.uk` emails. |
| Jobs per customer | Landlord "Harbourside Lettings Ltd" 12 (the multi-job customer, different rental addresses), landlord "Clifton & Redland Property Co." 8, business "The Larder Café Group" 6, business "Wells Road Dental Practice" 5, homeowners 6, 5, 4, 4, 3, 3, 2, 2 (= 60). Homeowner jobs are at the billing address (different rooms); landlord/business jobs at site addresses. |
| Job types | interior_repaint 18, exterior_repaint 10, wallpapering 9, kitchen_cabinet_spray 8, staircase_woodwork 9, commercial_unit 6 (business customers only). |
| Price ex VAT | interior £650-3,200; exterior £1,800-6,500; wallpapering £350-1,600; kitchen £1,200-2,800; staircase £450-1,400; commercial £3,500-12,000; rounded to £5. VAT = round(20%). |
| Completion dates | 60 completed jobs; `completed_on` per month m0..m5 = 8, 11, 11, 10, 10, 10. m0 dates fall between the 1st and `anchor` (all on the 1st if anchor is the 1st). Duration 1-10 working days by type; `scheduled_start` = completed_on - duration. |
| Painters | Each painter has 7-13 jobs; Dan Hughes has 10. |
| Reports | 60 (one per job). `submitted_at` = completion day 15:00-18:30 London, or next morning 08:00-09:30 for 1 in 6. 9 `awaiting_review`: the 6 most recent m0 reports plus 3 from m1. Others reviewed by Sarah 1-3 days after submission (never after anchor 17:00). |
| Painter notes | 2-4 sentences from a catalogue per type; 5 reports have none. |
| Checklist | 5-8 items per report from a per-type catalogue; 1 in 5 reports has one item `done = false` with a note (snagging). |
| Photos | 4-10 per report: before 1-3, during 1-3, after 2-4. `taken_at`: before on start morning, during on intermediate days (or start day), after on completion afternoon, all before `submitted_at`. Captions from per-type, per-stage catalogue ("Before: water-stained ceiling in hallway"). 1600x1200; staircase jobs 1200x1600. Total about 420. |
| Quotes | 24 jobs have an accepted quote issued 7-21 days before start. 14 of them requested a 25% deposit (rounded to £5), each paid by card or bank transfer 2-10 days before start. 3 quoted jobs were invoiced with extras (£120-480 ex VAT) above the quote. |
| Invoices (52) | Not invoiced 8 (7 awaiting review, 1 reviewed). Derived status: draft 6 (2 awaiting review, 4 reviewed), sent 7, part_paid 2, overdue 6 (one of them part-paid), paid 30, void 1. Issue date 0-3 days after review (never after anchor), due = issue + terms. The generator chooses which jobs get which status so dates are consistent (overdue from older jobs with due < anchor; sent from recent jobs with due >= anchor) and **asserts** the derived distribution above. When the anchor is on or after the 10th of its month, at least 3 invoices are issued in m0 (late-m1 jobs invoiced early in m0, plus reviewed m0 jobs). |
| Payments | Paid invoices: one payment (or two for 5 of them) totalling the balance, received between issue date and 10 days after due. Part-paid: one payment of 40-60% of total. Deposits as above. Methods: bank transfer 60%, card 35%, cash 5%. |

Edge cases (fixed, by natural key):
- **No photos**: one m0 interior repaint report, awaiting review, with checklist and notes but zero photos.
- **Long address and notes**: one Harbourside Lettings job at `Flat 14, The Old Chapel Apartments, 112-118 St Michael's Hill Road` / `Kingsdown Conservation Area (rear entrance via Montague Place)` / Bristol / City of Bristol / `BS2 8DT`, with ~1,200 characters of job notes and ~800 characters of painter notes.
- **Part-paid**: three part-paid invoices: two within terms (`part_paid`) and one past due (`overdue`).
- **Several jobs**: Harbourside Lettings (12 jobs) spans most statuses.
- **Void**: one voided invoice for a reviewed job, which then shows billing status `void`.

The seed module also exports `DEMO_ACCOUNTS` (used by `/auth/demo-accounts`) and the test suite
computes all expected dashboard figures and counts from `build_dataset()`.

## API

Contract: [api/openapi.yaml](../api/openapi.yaml) (authoritative; this table is a summary).

| Operation | Personas | Notes |
|---|---|---|
| `GET /health` | anyone | 200 `{status: ok, database: ok}` after `SELECT 1` (2s timeout), 503 when the DB is down |
| `POST /api/v1/auth/login` | anyone | 200 token + user; 401 `invalid_credentials`; 422 bad body |
| `GET /api/v1/auth/me` | any signed-in user | 401 without valid token |
| `GET /api/v1/auth/demo-accounts` | anyone, only when enabled | manager and painter credentials; 404 when disabled |
| `GET /api/v1/manager/dashboard` | manager | figures per assumption A3, `recent_reports` 5 by `submitted_at` desc |
| `GET /api/v1/manager/painters` | manager | `[{id, name}]` by name, for the filter |
| `GET /api/v1/manager/reports` | manager | filters `review_status`, `billing_status`, `painter_id`, `date_from`, `date_to`, `q`; pagination; sort `completed_on` desc, `submitted_at` desc, `reference` desc |
| `GET /api/v1/manager/reports/{id}` | manager | full evidence; 404 unknown id; 422 malformed uuid |
| `GET /api/v1/manager/invoices` | manager | filter `status` (derived); sort drafts first, then `issue_date` desc, `number` desc |
| `GET /api/v1/photos/{id}/image` | holder of a valid signed URL | SVG; 403 `invalid_signature` on bad or expired signature; 404 unknown photo |

401 vs 403: no/invalid/expired token or inactive user = 401 `unauthenticated`; valid painter token
on a manager route = 403 `forbidden`. Both return `application/problem+json`.

## Backend

- Routers: `routers/health.py`, `routers/auth.py`, `routers/manager.py` (router-level
  `dependencies=[Depends(require_roles(Role.manager))]`), `routers/photos.py`.
- Services take a `Session` and return Pydantic schemas. Queries avoid N+1: list endpoints use a
  single query with joins plus aggregated subqueries (`photo_count`, `paid_pence`) and a
  `count(*) OVER ()` or separate count query for `total`. Derived invoice status in SQL is a
  `CASE` expression mirroring `invoice_status()` with `today` bound as a parameter.
- Report detail loads job, customer (with `job_count`), painter, reviewer, checklist (by
  position), photos (stage order before, during, after, then `taken_at`, then position), quote,
  invoice and payments with `selectinload`.
- Photo URLs: `PUBLIC_API_BASE_URL + /api/v1/photos/{id}/image?variant=thumb|full&exp=..&sig=..`.
  Verification uses `hmac.compare_digest`; `exp` in the past is 403. Response
  `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`, and
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` on the SVG.
- Placeholder SVG: background colour by stage (before: muted grey-blue, during: amber, after:
  green), a simple wall/window/door illustration chosen by `hash(photo_id)`, overlay text: job
  reference, stage, caption (wrapped, max 3 lines), London timestamp. All text XML-escaped. Under
  6 KB each. Thumb and full share the drawing with different `width`/`height` attributes.
- Validation: unknown enum values, `page_size > 100`, `page < 1`, bad dates, `date_to < date_from`,
  `q` over 100 chars give 422 `validation_error` with `errors[]`.
- All responses pass through the request-id and JSON logging middleware (T-000 spec 6.7).

## Shared (`@jobproof/shared`, used by web now and mobile later)

- Generated: types and SDK functions from the contract (`src/generated`).
- `createApiClient({ baseUrl, tokenStore, onUnauthorized })` (Adapter): sets base URL and bearer
  header, converts problem responses and network failures to `ApiError` (`status` 0 for network
  or timeout, `code` from the problem, `requestId`).
- Hooks (TanStack Query): `useLogin`, `useMe`, `useLogout`, `useDemoAccounts`, `useDashboard`,
  `useReports(filters)`, `useReport(id)`, `useInvoices(filters)`, `usePainters`.
  Query keys in `queryKeys.ts`. List hooks keep previous data while paging. Retry once on
  network/5xx, never on 4xx.
- `filters.ts`: `ReportFilters`/`InvoiceFilters` types, `parse(searchParams)` and `serialise()`
  so web URL query state and mobile params share one implementation; invalid values are dropped.
- `format/`: `formatPence(pence)` -> `£1,234.56` (`Intl.NumberFormat('en-GB', {style:'currency', currency:'GBP'})`),
  `formatDate('2026-11-07')` -> `7 Nov 2026`, `formatDateTime(iso)` -> `7 Nov 2026, 14:05`
  in Europe/London, enum label maps (`part_paid` -> "Part paid", `kitchen_cabinet_spray` ->
  "Kitchen cabinet spray", `awaiting_review` -> "Awaiting review").
- Platform-specific: token storage, routing, rendering, lightbox.

## Web

Plain CSS modules, system font stack, no UI kit, no external fonts or icons (inline SVG icons).
Responsive down to 360px (tables scroll horizontally inside their card). Accessible: semantic
tables, labelled form controls, visible focus, badges with text (not colour alone).

Routing (`react-router` data mode):

| Path | Screen | Guard |
|---|---|---|
| `/login` | Login | signed-in managers are redirected to `/` |
| `/` | Dashboard | manager |
| `/reports` | Reports list; filters and page in the URL query | manager |
| `/reports/:reportId` | Report evidence | manager |
| `/billing` | Billing (invoices) | manager |
| `/not-authorised` | "This app is for head-office managers" with Sign out | signed in, non-manager |
| `*` | Not found with link to dashboard | |

Guard: no token -> `/login?from=<path>`. Token present -> `useMe`; while loading show a full-page
loading state; role painter -> `/not-authorised` without mounting any manager page or calling
manager endpoints; 401 at any point -> clear token, go to `/login?from=...` with notice
"Your session has expired. Please sign in again."

Screens:
- **Login**: email, password, "Sign in" button (disabled while submitting). 401 shows an alert
  "Email or password is incorrect." above the form, keeps the email, clears the password, stays on
  `/login`. Network error shows "Can't reach the server. Check it is running and try again."
  A "Demo accounts" panel (when `/auth/demo-accounts` returns 200) lists role, email and password
  with a "Use" button that fills the form; hidden when 404. On success store token, go to `from`
  or `/`.
- **App shell**: header with "JobProof", nav (Dashboard, Reports, Billing, current page marked
  with `aria-current`), signed-in user's `full_name`, "Sign out" (clears token and cache).
- **Dashboard**: five stat cards: Reports awaiting review (links to
  `/reports?review_status=awaiting_review`), Jobs completed this month, Invoiced this month,
  Outstanding (links to `/billing`), Overdue invoices (links to `/billing?status=overdue`); month
  label from `period_start` ("November 2026"). Below, "Recent reports" table (job ref, customer,
  painter, submitted, review badge) linking to each report, and "View all reports".
- **Reports**: filter bar: search box (debounced 300 ms, placeholder "Customer, address or job
  ref"), Review status select (All, Awaiting review, Reviewed), Billing status select (All plus 7
  statuses), Painter select (from `usePainters`), Completed from/to date inputs, "Clear filters".
  Any filter change resets to page 1. Result line "Showing 21-40 of 60 reports" (`total`). Table
  columns: Job ref (link), Customer, Site address (line1, town, postcode; truncated with full text
  in `title`), Painter, Completed, Photos, Review, Billing. Pagination: Previous / "Page 2 of 3" /
  Next. Empty state "No reports match these filters" with Clear filters.
- **Report evidence**: back link to the list (preserving its query), heading `JP-1042 · <title>`,
  review and billing badges. Sections: Job details (type, status, scheduled start, completed,
  site address, notes with preserved line breaks), Customer (name, type, contact, email, phone,
  billing address, "N jobs with us"), Painter (name, submitted at, reviewed by/at or "Awaiting
  review"), Painter notes, Checklist (ticked/unticked with notes; incomplete items highlighted),
  Photos (grouped Before / During / After with counts, thumbnail grid with caption and timestamp;
  click or Enter opens a lightbox `<dialog>` with full image, stage, caption, timestamp, "3 of 8",
  previous/next buttons and arrow keys, Esc or Close returns focus to the thumbnail), Billing
  (quote reference, total, deposit requested/paid or "No quote"; invoice number, status, subtotal,
  VAT, deposit applied, total, paid, balance, issue/due dates or "Not invoiced yet"; payments
  table). No photos: "No photos were submitted with this report." Unknown id: "Report not found"
  with link to Reports.
- **Billing**: status select (All, Draft, Sent, Part paid, Overdue, Paid, Void) in the URL, result
  count, table: Invoice no., Customer, Job ref, Amount, Paid, Due date ("-" for drafts), Status
  badge, "View report" link (`/reports/{report_id}`). Pagination as Reports. Empty state "No
  invoices with this status".

States (scenario 9), one shared `QueryBoundary`-style component used by every data view:
- Loading: skeleton rows/cards with `role="status"` and text "Loading..." (visually hidden is
  fine), shown immediately; previous data kept while paging with a subtle busy indicator.
- Error: "Something went wrong loading <thing>." plus the API `detail` when present, request id
  ("Ref: <id>") for support, and a "Try again" button that refetches. Network errors use the
  "Can't reach the server" message. Never a blank page; a top-level React error boundary renders
  a fallback with "Reload".
- Empty: per-screen messages above; dashboard recent reports empty shows "No reports yet".

Test hooks (stable for e2e): `data-testid` on `stat-awaiting-review`, `stat-completed-month`,
`stat-invoiced-month`, `stat-outstanding`, `stat-overdue`, `user-name`, `result-count`,
`reports-table`, `invoices-table`, `photo-thumb`, `lightbox`, `error-state`, `empty-state`,
`loading-state`, `retry-button`.

Runtime config: `window.__JOBPROOF_CONFIG__.apiBaseUrl` from `/config.js` (T-000 spec 6.6).

## Mobile

Out of scope. Everything in `shared/` stays DOM-free so the Expo app can reuse the hooks,
formatting and filter logic.

## Infra / local

- Env vars as T-000 spec 6.6. No new services.
- Compose and `scripts/dev.sh` as T-000 spec section 4; seed runs on every `make up`.
- No outbound network at runtime: backend makes no outbound calls; the web bundle references no
  external origin (no CDN fonts, scripts or images); placeholder images are served by the backend.

## Test notes

Reference instant for automated tests: `SEED_ANCHOR_DATE=2026-10-15`,
`FIXED_NOW=2026-10-15T10:00:00Z`. Expected numbers come from `build_dataset()`, never hard-coded
from SQL output.

| T-001 scenario | Behaviour to test | Ticket |
|---|---|---|
| 1 Sign in | API login 200 with user; `/auth/me`; web login lands on `/` with "Sarah Whitfield" in header | c, d |
| 2 Bad credentials | 401 `invalid_credentials` for wrong password, unknown email, password-less painter; UI alert, still on `/login`, password cleared | c, d |
| 3 Manager only | Every `/api/v1/manager/*` route: no token 401, malformed/expired/wrong-secret token 401, painter token 403, manager 200 (parametrised over the contract's manager operations); route-parity test ensures none is missed. Web: painter login shows `/not-authorised`, direct `/reports` as painter never requests manager endpoints | c, d |
| 4 Dashboard | Five figures equal dataset-derived values; recent 5 match `submitted_at` order; UI shows formatted values | c, d |
| 5 List | Default page: 20 items, `total` 60, newest first, all columns; page 3 has 20; page 4 empty with total 60 | b, c, d |
| 6 Filter/search | Each filter alone and combined; `q` by customer name (case-insensitive), postcode with and without space, partial address, job ref; count updates; no-match gives empty state; `date_to < date_from` 422 | c, d |
| 7 Evidence | Detail for a normal report, the no-photo report and the long-address report; photo order; signed URLs load SVG (200 `image/svg+xml`), tampered sig 403, expired 403; lightbox opens/navigates/closes | b, c, d |
| 8 Billing | Status filter counts equal the dataset distribution; part-paid amounts; `report_id` link opens report | c, d |
| 9 Resilient states | Playwright route interception: delayed response shows loading; empty lists show empty states; 500 and aborted requests show error with Try again, and retry recovers | d |
| 10 Offline | `docker compose config` valid; dev.sh brings stack up from clean; full e2e passes; built bundle contains no external URLs; backend has no outbound calls | a, d |

Edge cases: page_size 100 and 101; unknown query params ignored; SQL wildcard characters in `q`
(`%`, `_`) match literally; month boundary (anchor on the 1st); report with zero photos shows 0 in
list; reviewed job with a void invoice; seed run twice gives identical rows.

## Out of scope

Creating or editing anything (including marking reports reviewed), painter app and uploads,
customer payment links, Stripe, email, real identity providers, refresh tokens, AWS deployment,
mobile, CSV export.

## Implementation tickets (ordered)

1. [T-001a: Scaffold, local stack and health endpoint](../tickets/T-001a-scaffold-and-stack.md)
2. [T-001b: Data model, migrations and seed data](../tickets/T-001b-data-model-and-seed.md)
3. [T-001c: Authentication and manager read API](../tickets/T-001c-auth-and-manager-api.md)
4. [T-001d: Manager web UI and end-to-end tests](../tickets/T-001d-manager-web-ui.md)
