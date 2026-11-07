# T-002f: Audit trail (who, when, what) and the History panel

**Persona:** Manager (reads history); Admin (settings changes are recorded)
**Owners:** backend-engineer (store, service, endpoint), frontend-engineer (History panel)
**Depends on:** T-002c, T-002e, T-002g
**Part of:** [T-002](T-002-admin-branding-review-workflow.md)

## Context
Reports are billing evidence. Once they can be reviewed and edited, the office must be able to
see who changed what and when, and nobody (including managers) may rewrite that history. This
ticket builds the append-only audit trail, records the events that already exist (review in
T-002g, Admin settings in T-002c/T-002e) and shows a History panel on the report page. T-002i
adds the edit events.

An event has: when (UTC), who (user id and the name at that time), what action, which record
(report or settings), the request id, and for field changes the field, old value and new value.
Actions: `report.reviewed`, `report.reopened`, `report.edited` (T-002i), `settings.changed`.

## Scenarios

### 1. Marking a report reviewed is recorded
Given Sarah Whitfield marks an awaiting-review report reviewed (T-002g)
When `GET /api/v1/manager/reports/{id}/history` is called
Then the newest event is `report.reviewed` by Sarah Whitfield with a UTC timestamp within a few
seconds of the action, and it matches the report's `reviewed_at`

### 2. Admin settings changes are recorded with old and new values
Given Tom Ashworth changes the company name from "Arbour Services" to "Arbour Tree Care Ltd" and
the primary colour from `#1F5130` to `#1F3A5F`
Then one `settings.changed` event exists with two changes (field, old, new) and Tom Ashworth as
actor, and the event is not visible to managers or painters (403 for their tokens on the admin
history endpoint)
And a save that changes nothing records no event

### 3. History panel on the report page
Given a report with three events
When the manager opens the report
Then a History section lists them newest first, each showing the time (London time, e.g.
"15 Oct 2026, 11:42"), the person's name, a sentence ("Priya Nair changed Painter notes") and,
for changes, old and new values
And values longer than 200 characters are cut with a "Show full change" toggle

### 4. Empty state
Given a seeded report that nobody has touched
When it is opened
Then History shows "No changes recorded yet."

### 5. History is append-only
Given the API and the database user the application runs as
Then no endpoint can edit or delete an audit event, and a test proves the application role cannot
UPDATE or DELETE rows in the audit table (the architect chooses how to enforce this)

### 6. Names stay as they were
Given Priya Nair edits a report and is later renamed "Priya Nair-Singh"
When history is read
Then the old event still shows "Priya Nair"

### 7. Only managers read report history
Given every new history operation
When called with no token, a painter token and an admin token
Then they return 401, 403 and 403, and an unknown report id returns 404 `not_found`

### 8. Failure states
Given the history request fails or is slow
Then the panel shows a loading state, then an error with "Try again", and the rest of the report
page is unaffected

### 9. Failed actions leave no trace
Given a stale-version save or a rejected validation
Then no audit event is written

## Out of scope
Exporting or filtering history, a global activity feed, tamper-evident hashing, events for logins,
history of photos (read-only), Admin history screen (events are stored; a viewer is a later
ticket).

## Open questions
- How long must audit events be kept? Default: indefinitely.
- Should the Admin have a screen to view settings history? Default: not now.
