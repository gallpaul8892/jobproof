# T-001b: Data model, migrations and deterministic seed data

**Persona:** Developer (internal), on behalf of Manager
**Owner:** backend-engineer
**Depends on:** T-001a
**Specs:** [specs/T-001-manager-view.md](../specs/T-001-manager-view.md) sections "Data",
"Derived values" and "Mock data"; [specs/T-000-bootstrap.md](../specs/T-000-bootstrap.md) 6.5,
6.8, 6.9.

## Context
Create the nine Phase 1 tables with Alembic, the pure billing functions, the deterministic seed
dataset and the placeholder photo renderer. No HTTP endpoints beyond `/health` change. All tests
use `SEED_ANCHOR_DATE=2026-10-15` unless stated.

## Scenarios

### 1. Migration creates the schema and round-trips
Given an empty database
When `alembic upgrade head` runs
Then tables users, customers, jobs, quotes, job_reports, report_checklist_items, report_photos,
invoices and payments exist with the columns, enums, foreign keys, indexes and CHECK constraints
in the T-001 spec, using the naming convention
And `alembic downgrade base` then `alembic upgrade head` succeed, and `alembic check` reports no
drift between models and migrations

### 2. Constraints reject invalid data
Given the migrated schema
When a test inserts a payment of kind deposit with an invoice_id, an invoice whose total does not
equal subtotal + VAT - deposit applied, a draft invoice with an issue date, a second non-void
invoice for the same job, a completed job with no completed_on, or a currency other than GBP
Then each insert fails with an integrity error

### 3. Seed loads the specified volumes
Given the migrated schema
When `python -m app.seed` runs
Then the database holds 7 users (1 manager, 6 painters; only manager@jobproof.test and
painter@jobproof.test have password hashes), 12 customers (8 homeowners, 2 landlords, 2
businesses), 60 completed jobs with the per-type and per-month counts, 60 reports with 9 awaiting
review, every report with 5 to 8 checklist items, between 4 and 10 photos per report except
exactly one report with none, 24 accepted quotes with 14 paid deposits, and 52 invoices
And the derived invoice statuses are exactly draft 6, sent 7, part_paid 2, overdue 6, paid 30,
void 1, with 8 jobs not invoiced

### 4. Seed is deterministic and idempotent
Given a seeded database
When the seed runs again with the same anchor date
Then every table contains identical rows (same ids and values) and the run succeeds without
duplicates
And `build_dataset(anchor)` called twice in Python returns equal datasets

### 5. Seed data is internally consistent
Given the dataset for anchors 2026-10-15, 2026-11-01 and 2027-03-31
When consistency checks run
Then for every job scheduled_start <= completed_on <= anchor; photo taken_at values are before
the report's submitted_at; reviewed_at is after submitted_at and not after the anchor; issue dates
are after review and not after the anchor; due = issue + customer terms; payments sum to the
total for paid invoices and are below the total for part-paid; every invoice's customer equals its
job's customer; deposits are paid before the job starts
And the current month (m0) has 8 completed jobs, and for the anchors on or after the 10th
at least 3 invoices are issued in m0

### 6. Edge cases are present
Given the seeded data
Then there is one awaiting-review report with zero photos, one Harbourside Lettings job whose
site address is the long address in the spec with job notes of at least 1,000 characters,
three part-paid invoices of which one is overdue, Harbourside Lettings has 12 jobs, and one
reviewed job's only invoice is void

### 7. Invoice status function matches the specification
Given `invoice_status(state, total, paid, due_date, today)`
When it is called with each combination in a table-driven unit test (void, draft, fully paid
past due, unpaid past due, part paid past due, part paid in terms, unpaid in terms, due date equal
to today)
Then it returns void, draft, paid, overdue, overdue, part_paid, sent, sent respectively

### 8. Placeholder photos render offline and safely
Given any seeded photo row
When `PlaceholderPhotoStore.render(photo, "thumb")` and `render(photo, "full")` are called
Then each returns valid SVG (parses as XML) with content type `image/svg+xml`, under 6 KB,
containing the job reference, stage label and caption, with no external references (no `href`
or `url(` to any http origin)
And a caption containing `<script>&"'` is rendered escaped
And `url_for(photo, variant)` produces a URL whose signature verifies, and fails verification
when the photo id, variant or exp is changed or exp is in the past

### 9. Dev and compose paths seed on start
Given `scripts/dev.sh down` and then `scripts/dev.sh up`
When the stack is running
Then `scripts/dev.sh psql -c "select count(*) from jobs"` returns 60 and `/health` is ok
And `make up` (compose) runs migrate then seed before the backend starts, per the compose
dependency conditions

## Out of scope
Auth, manager API and UI. Later-phase tables (invoice_line_items, payment_links).
