# T-002i: Edit a report (API, concurrency, audit, reopen)

**Persona:** Manager
**Owner:** backend-engineer (architect updates the contract first)
**Depends on:** T-002f, T-002g
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decisions D3, D4, D5

## Context
Managers correct and annotate reports before billing: a typo in the painter's notes, a checklist
item ticked that was done but not marked, an internal note ("Customer confirmed snag fixed by
phone"). Editable: `painter_notes`, each checklist item's `done` and `note`, and a new internal
`manager_notes`. Everything else, including photos and checklist labels, is read-only. Edits use
`PATCH /api/v1/manager/reports/{id}` with the `version` the manager loaded. Editing a reviewed
report returns it to awaiting review.

## Scenarios

### 1. Edit the painter notes
Given an awaiting-review report at version 1 with painter notes "Two coats, ceiling done."
When Sarah sends `{"version": 1, "painter_notes": "Two coats on walls, ceiling done."}`
Then the response is 200 with the new notes and `version` 2, the review status is still
awaiting_review, and the history has a `report.edited` event with field `painter_notes`, the old
and new text, and Sarah as actor

### 2. Edit checklist items
Given a report with checklist item "Skirting boards gloss" not done
When the manager sends `checklist: [{"id": <item id>, "done": true, "note": "Done 16 Oct, confirmed
by phone"}]`
Then the item is done with that note, other items are untouched, one audit event lists the
change(s), and only the sent items are modified

### 3. Add an internal manager note
Given a report with no manager notes
When the manager sets `manager_notes` to "Customer asked for invoice by email."
Then it is stored and returned, and is labelled internal (painter-authored fields are never
overwritten by it)

### 4. Editing a reviewed report reopens it
Given a report reviewed by Sarah on 12 Oct (version 5)
When Priya edits the painter notes (version 5)
Then the report is `awaiting_review`, `reviewed_by` and `reviewed_at` are null, version is 6, and
the history has a `report.edited` event and a `report.reopened` event that records Sarah and the
original review time
And the dashboard awaiting-review count rises by one

### 5. No-op edits change nothing
Given the body repeats the current values
When it is sent with the current version
Then the response is 200 with the same version, a reviewed report stays reviewed, and no audit
event is written

### 6. Stale version
Given Sarah and Priya both loaded a report at version 3
When Priya saves a notes change (version becomes 4) and then Sarah saves a different change with
version 3
Then Sarah gets 409 `version_conflict` including the current version, who last changed the
report (Priya Nair) and when, no data is written and no audit event is created
And the response also carries the current values of the fields Sarah tried to change so the
client can show them

### 7. Two edits at the same instant
Given two simultaneous PATCH requests with the same version
Then exactly one returns 200 and the other 409 (a test with two real connections)

### 8. Read-only things stay read-only
When the body contains `photos`, `review_status`, `reviewed_by`, `version` changes, a checklist
`label`, a new or removed checklist item, a job or customer field, or an unknown field
Then the API returns 422 `validation_error` naming the field and changes nothing
And a checklist `id` that belongs to another report returns 422

### 9. Validation
Given the body
When `painter_notes` or `manager_notes` is longer than 5,000 characters or contains NUL, a
checklist note is longer than 500 characters, `done` is not a boolean, the body has no editable
field, or `version` is missing
Then the API returns 422 `validation_error` with an `errors` entry per problem
And clearing notes (empty string) is allowed and stored as null

### 10. Authorisation
Given the PATCH operation
When called with no token, a painter token and an admin token
Then it returns 401, 403 and 403, an unknown id 404 and a non-uuid id 422

### 11. Atomic
Given a body with a valid notes change and an invalid checklist item
Then nothing is saved and no audit event is written

### 12. Contract
Then the operation, the new fields and the 409/422 problem codes are in `api/openapi.yaml`,
route parity and `assert_contract` pass, the generated client is regenerated and committed, the
seed gains `manager_notes` as null, and re-seeding is identical

## Out of scope
Photos (add, remove, caption, reorder), checklist labels and structure, job and customer details,
completion date, invoice or quote changes, history revert, drafts.

## Open questions
- Should Managers also be able to correct the job's completion date? Default: no (it drives
  month-end figures and billing; later ticket if needed).
- Should editing a reviewed report really reopen it? Default: yes (D3).
