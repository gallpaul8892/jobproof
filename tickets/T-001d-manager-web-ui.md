# T-001d: Manager web UI and end-to-end tests

**Persona:** Manager
**Owners:** frontend-engineer (shared hooks and web), test-engineer (Playwright suite)
**Depends on:** T-001c
**Specs:** [specs/T-001-manager-view.md](../specs/T-001-manager-view.md) sections "Shared",
"Web" and "Test notes"; [specs/T-000-bootstrap.md](../specs/T-000-bootstrap.md) section 5.

## Context
Build the manager pages on the generated client, with shared DOM-free hooks, formatting and
filter logic in `@jobproof/shared`. E2E tests run against `scripts/dev.sh up --static` (the
production build served with runtime `config.js`). Expected figures in e2e come from the API
(called directly in the test with the manager token) so the UI is checked against live data;
backend tests already check the API against the seed.

## Scenarios

### 1. Sign in as manager
Given the stack is running with seeded data
When the manager opens http://localhost:8080, is redirected to `/login`, clicks "Use" on the
manager demo account and submits
Then they land on `/` (the dashboard) and the header shows "Sarah Whitfield"
And reloading the page keeps them signed in, and "Sign out" returns them to `/login`

### 2. Bad credentials are rejected
Given the login page
When someone submits the manager email with a wrong password
Then the alert "Email or password is incorrect." is shown, the URL is still `/login`, the email
is kept and the password field is empty

### 3. The web app never shows manager pages to others
Given a painter signs in with the painter demo account
When they land, and then navigate directly to `/`, `/reports`, `/reports/<any id>` and `/billing`
Then each shows the "not authorised" page with a Sign out button, no manager data is rendered,
and no request to `/api/v1/manager/` is made (asserted with request listening)
And with no token, visiting `/billing` redirects to `/login?from=%2Fbilling`, and after signing
in as the manager they arrive at `/billing`
And when the API returns 401 mid-session, the token is cleared and the login page shows
"Your session has expired. Please sign in again."

### 4. Dashboard summary
Given the manager is on the dashboard
Then the five stat cards show the dashboard API's values, with money formatted like `£12,345.60`
and the month label like "November 2026"
And "Recent reports" lists 5 reports in the API order, each linking to its evidence page
And clicking "Reports awaiting review" opens `/reports?review_status=awaiting_review` showing the
same count

### 5. List job reports
Given the manager opens Reports
Then a table shows 20 rows with job ref, customer, site address, painter, completed date, photo
count, review status and billing status, newest first, and "Showing 1-20 of 60 reports"
And Next shows "Showing 21-40 of 60 reports", and the page is kept in the URL so reload and Back
restore it

### 6. Filter and search reports
Given the reports list
When the manager types part of a customer name, a postcode or a job reference into search, or
picks a review status, billing status, painter or completed date range
Then the table and result count update to the matching rows, the filters appear in the URL, and
any change returns to page 1
And a search with no matches shows "No reports match these filters" with a Clear filters button
that restores all 60

### 7. View evidence for a report
Given a report with photos in the list
When the manager opens it
Then they see job details, painter notes, checklist, customer details, painter, photos grouped
Before, During and After with captions and timestamps, and the quote, deposit, invoice and
payments with formatted amounts
And clicking a thumbnail opens the lightbox with the full image, caption, timestamp and "n of N";
arrow keys and Next/Previous move between photos; Esc closes it and focus returns to the thumbnail
And the no-photo report shows "No photos were submitted with this report.", the long-address
report shows the whole address and notes without breaking the layout at 360px width, and an
unknown report id shows "Report not found"

### 8. Billing overview
Given the manager opens Billing
Then a paginated table lists invoices with invoice number, customer, job ref, amount, paid, due
date and status, with a result count of 52
And choosing "Overdue" shows only overdue invoices with the API's count, kept in the URL
And "View report" on a row opens that job's evidence page

### 9. Resilient states
Given Playwright intercepts API calls
When the dashboard, reports, report detail and billing requests are delayed by 2 seconds
Then a loading state (`data-testid="loading-state"`) is visible before data appears
When the lists return empty pages
Then each shows its empty state
When the requests fail with 500 or the network aborts
Then each page shows an error state with a "Try again" button, and after removing the
interception "Try again" loads the data
And at no point is the page blank (main landmark always has visible text)

### 10. Runs locally, offline
Given the stack started with `scripts/dev.sh up --static`
When `make lint`, `make test` and `make e2e` run
Then all pass, the full scenario suite above passes in Chromium, and no browser request goes to
any origin other than localhost:8080 and localhost:8000 (asserted in a Playwright fixture for
every test)
And `make up` with docker compose on a machine with Docker serves the same app at the same URLs
and prints the demo credentials (verified by the user; the orchestrator verifies
`docker compose config`)

### Unit tests (vitest)
Given the shared package
Then `formatPence`, `formatDate`, `formatDateTime` (including a BST/GMT boundary), enum labels,
and filter `parse`/`serialise` round-trips (dropping invalid values) are covered, and the
`ApiError` adapter maps problem responses, network errors and timeouts

## Out of scope
Any write action, mobile, reviewing reports, CSV export, visual design beyond the spec.
