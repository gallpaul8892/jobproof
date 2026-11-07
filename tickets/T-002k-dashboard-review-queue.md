# T-002k: Dashboard review queue (next 5 reports to review, oldest first)

**Persona:** Manager
**Owners:** backend-engineer (dashboard field, list sort), frontend-engineer (queue panel)
**Depends on:** T-001d only (works on today's data; can be built before T-002g)
**Part of:** [T-002](T-002-admin-branding-review-workflow.md)

## Context
The home page should answer "what do I do next?". A queue shows the five reports that have been
waiting longest for review, oldest first, each linking to the report, plus a link to see all of
them. It sits under the stat cards; the existing "Recent reports" list stays below it. With the
seed anchor 2026-10-15 there are 9 awaiting-review reports (3 from the previous month, 6 from the
current month, one with no photos), so the queue shows 5 and the link shows "View all 9".

"Oldest" means earliest `submitted_at`; ties are broken by job reference ascending.

## Scenarios

### 1. Queue content and order
Given the seeded data and the fixed clock
When the manager opens the dashboard
Then "Review queue" lists exactly 5 reports: the 5 awaiting-review reports with the earliest
`submitted_at`, oldest first, equal to the first 5 of the 9 computed from the dataset
And each row shows job reference, customer, site address, painter, submitted date and time, and
how long it has waited ("Waiting 12 days")

### 2. Each row links to the report
Given the queue
When the manager clicks a row's job reference or "Review"
Then the report page opens at `/reports/<id>` for that report

### 3. Link to all awaiting review
Given 9 reports awaiting review
Then the panel shows "View all 9 awaiting review" which opens
`/reports?review_status=awaiting_review&sort=submitted_asc`, showing 9 reports in the same order
as the queue followed by the other 4, with the result count "Showing 1-9 of 9 reports"

### 4. Fewer than five
Given only 3 reports are awaiting review
Then the queue shows 3 rows and the link reads "View all 3 awaiting review"

### 5. Empty state
Given no reports are awaiting review
Then the panel shows "Nothing is waiting for review." and no list or link

### 6. Queue updates when work is done
Given the manager marks the oldest report reviewed (after T-002g/h)
When they return to the dashboard
Then it no longer appears, the sixth report moves into the fifth place and the count reads 8

### 7. API
Given `GET /api/v1/manager/dashboard`
Then the response has `review_queue` (an array of at most 5 report summaries, with `submitted_at`)
and the existing fields are unchanged
And `GET /api/v1/manager/reports` accepts `sort` with `default` (existing order) or
`submitted_asc` (submitted_at ascending, then job reference ascending); any other value returns
422; with no `sort` the order is unchanged
And the dashboard stays within the SQL query bound of T-001c scenario 10

### 8. Authorisation
Given the dashboard operation
Then the review queue is returned to managers only (painter and admin tokens get 403, no token
401) as before

### 9. Resilient states
Given the dashboard request is slow or fails
Then the queue shows the same loading and error-with-retry behaviour as the rest of the page, and
the no-photo report appears in the queue like any other

## Out of scope
Assigning reports to managers, SLA colours or alerts, email reminders, reordering the queue.

## Open questions
- Should the queue replace "Recent reports" rather than sit above it? Default: keep both; Paul to
  say if the dashboard feels crowded.
- Should "waiting" be coloured when it passes a threshold (for example 5 days)? Default: no.
