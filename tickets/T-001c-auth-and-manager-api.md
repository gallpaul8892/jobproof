# T-001c: Authentication and manager read API

**Persona:** Manager
**Owner:** backend-engineer
**Depends on:** T-001b
**Specs:** [specs/T-001-manager-view.md](../specs/T-001-manager-view.md) sections "API",
"Backend" and "Test notes"; [api/openapi.yaml](../api/openapi.yaml);
[specs/T-000-bootstrap.md](../specs/T-000-bootstrap.md) 6.1 to 6.4.

## Context
Implement every operation in the contract. Tests run against the seeded test database with
`SEED_ANCHOR_DATE=2026-10-15` and `FIXED_NOW=2026-10-15T10:00:00Z`; expected values are computed
from `build_dataset()`, not hard-coded from query output. Every API test validates its response
with `assert_contract`. When this ticket is done `NOT_YET_IMPLEMENTED` is empty.

## Scenarios

### 1. Manager signs in
Given the seeded manager account
When `POST /api/v1/auth/login` is called with `Manager@JobProof.test ` (mixed case, trailing
space) and `Manager123!`
Then it returns 200 with a bearer token, `expires_in` 1800 and user Sarah Whitfield with role
manager
And `GET /api/v1/auth/me` with that token returns the same user

### 2. Bad credentials are rejected uniformly
Given the login endpoint
When it is called with a wrong password, an unknown email, or the email of a painter who has no
password
Then each returns 401 `application/problem+json` with code `invalid_credentials` and the same
`detail`, and no token
And a body missing `password` returns 422 `validation_error` with an `errors` entry for it

### 3. Only managers can use manager endpoints
Given every operation under `/api/v1/manager/` in the contract (enumerated from the YAML)
When each is called with no token, a malformed token, an expired token, a token signed with
another secret, a token for a deactivated user, or a valid painter token
Then the first five return 401 code `unauthenticated` with `WWW-Authenticate: Bearer`, and the
painter token returns 403 code `forbidden`
And with the manager token each returns 200

### 4. Dashboard figures match the seed
Given the seeded data and the fixed clock
When the manager calls `GET /api/v1/manager/dashboard`
Then `reports_awaiting_review`, `jobs_completed_this_month`, `invoiced_this_month_pence`,
`outstanding_pence` and `overdue_invoice_count` equal the values computed from the dataset per
assumption A3, `period_start` is 2026-10-01 and `period_end` 2026-10-31
And `recent_reports` holds the 5 reports with the latest `submitted_at`, in that order

### 5. Reports list is paginated, newest first
Given 60 seeded reports
When the manager calls `GET /api/v1/manager/reports`
Then it returns 20 items, total 60, page 1, page_size 20, ordered by completed_on desc then
submitted_at desc then job reference desc, each with job reference, customer, site address,
painter, completed_on, photo_count and billing_status
And page 3 returns the last 20, page 4 returns no items with total 60, `page_size=100` returns
all 60, and `page_size=101` or `page=0` returns 422

### 6. Reports can be filtered and searched
Given the reports list
When the manager filters by each review_status, each billing_status, a painter_id, a date range,
or searches `q` with a customer name in lower case, a postcode with and without its space, part
of a street name, or a job reference such as `jp-1042`
Then only matching rows are returned and `total` equals the matching count from the dataset
And combining painter_id with review_status applies both
And `q=%` and `q=_` match nothing unless those characters appear literally, a search with no
matches returns total 0 and empty items, and `date_to` before `date_from` returns 422

### 7. Report detail returns all evidence
Given a seeded report with photos, a quote with a paid deposit and a part-paid invoice
When the manager calls `GET /api/v1/manager/reports/{id}`
Then the response includes job details, painter notes, checklist in position order, customer
details with job_count, painter, reviewer, photos ordered before, during, after then by taken_at
with captions, timestamps and signed `url` and `thumb_url`, the quote, the invoice with
subtotal, VAT, deposit applied, total, paid and balance, and the payments by received_at
And fetching its `thumb_url` and `url` without any auth header returns 200 `image/svg+xml`
And the same URL with one character of `sig` changed, or with `exp` in the past, returns 403
`invalid_signature`
And the no-photo report returns `photos: []`, the long-address report returns the full address
and notes unchanged, an unknown uuid returns 404 `not_found` and a non-uuid id returns 422

### 8. Billing list filters by derived status
Given 52 seeded invoices
When the manager calls `GET /api/v1/manager/invoices` with no filter and then with each status
Then the unfiltered total is 52 and each status total matches the seed distribution (draft 6,
sent 7, part_paid 2, overdue 6, paid 30, void 1)
And each row has customer, job reference, total, paid, balance, due date, status and the job's
`report_id`, drafts first then by issue_date desc

### 9. Demo accounts and contract parity
Given `DEMO_ACCOUNTS_ENABLED=true`
When `GET /api/v1/auth/demo-accounts` is called
Then it returns the manager and painter credentials, and with the flag false it returns 404
And the route-parity test passes with an empty `NOT_YET_IMPLEMENTED`, and Settings refuses to
start with `APP_ENV=production` and the flag true

### 10. Performance and logging
Given the seeded database
When each manager endpoint is called
Then each issues a bounded number of SQL queries independent of page size (asserted with a
SQLAlchemy event counter, at most 6) and responds in under 300 ms locally
And no log line contains the password, token or photo signature

## Out of scope
Web UI (T-001d). Any write endpoint, including marking reports reviewed.
