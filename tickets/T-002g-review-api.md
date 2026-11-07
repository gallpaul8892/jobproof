# T-002g: Mark a report reviewed (API, versioning)

**Persona:** Manager
**Owner:** backend-engineer (architect updates the contract first)
**Depends on:** T-002b (second manager in the seed)
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decisions D3 and D5

## Context
Reports arrive `awaiting_review`; a manager must explicitly mark one `reviewed`, which records
who and when. This is the first write endpoint in the product, so it also introduces the report
`version` that all later edits use for optimistic concurrency. Test data: with the seed anchor
2026-10-15 there are 9 reports awaiting review (6 recent from the current month, 3 from the
previous month, one of them with no photos) and 51 reviewed; the seed creates every report at
`version` 1.

## Scenarios

### 1. Report detail exposes version and review state
Given a seeded report
When `GET /api/v1/manager/reports/{id}` is called
Then the response includes `version` 1, `review_status`, `reviewed_at` and `reviewed_by`
(Sarah Whitfield for reviewed seed reports, null for awaiting)

### 2. Manager marks a report reviewed
Given an awaiting-review report at version 1 and Priya Nair's token
When `POST /api/v1/manager/reports/{id}/review` is called with `{"version": 1}`
Then it returns 200 with `review_status` `reviewed`, `reviewed_by` Priya Nair, `reviewed_at` equal
to the server time (UTC), and `version` 2
And the dashboard count of reports awaiting review drops from 9 to 8

### 3. Reviewing is not repeated
Given a report already reviewed by Sarah Whitfield
When Priya Nair calls review on it with the current version
Then it returns 409 `already_reviewed` naming Sarah Whitfield and the time, and `reviewed_by`
and `reviewed_at` are unchanged

### 4. Stale version is refused
Given Sarah and Priya both loaded a report at version 1
When Priya marks it reviewed (version becomes 2) and then Sarah calls review with `version` 1
Then Sarah gets 409 `version_conflict` with the current version, who last changed it and when,
and nothing is written

### 5. Review requires a version
Given the request body
When `version` is missing, zero, negative, not an integer or a string
Then the API returns 422 `validation_error` with an `errors` entry for `version`

### 6. Authorisation
Given the review operation
When called with no token, a painter token and an admin token
Then it returns 401, 403 and 403, and the report is unchanged
And an unknown id returns 404 `not_found`, a non-uuid id 422

### 7. Race: two reviews at the same instant
Given two simultaneous review requests with the same version
Then exactly one succeeds (200) and the other gets 409, and the report has a single reviewer
(a concurrency test with two real connections)

### 8. Review records an audit event
Given T-002f exists
Then each successful review writes a `report.reviewed` event (covered in T-002f scenario 1)

### 9. Contract and billing unaffected
Then the operation is in `api/openapi.yaml`, route parity and `assert_contract` pass, the
generated client is regenerated and committed, and invoice statuses and billing figures are the
same as before and after a review

## Out of scope
Un-reviewing as its own action (only editing reopens, see T-002i), bulk review, reviewing from the
list, blocking invoices until a report is reviewed, notifications.

## Open questions
- Should a manager be able to review the report for a job they cannot see billing for? There is
  no such restriction today; default: all managers can review any report.
