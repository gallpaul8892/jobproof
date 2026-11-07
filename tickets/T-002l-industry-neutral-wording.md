# T-002l: Industry-neutral wording in the app

**Persona:** Manager, Admin
**Owner:** frontend-engineer (backend-engineer for demo-account labels)
**Depends on:** T-001d
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decision D7

## Context
The product serves different trades; the first customer, Arbour Services, are tree surgeons in
Glasgow, but the mock data is painting and decorating. The interface chrome must not say
"painter" or "decorating" where it applies to any trade. This ticket changes **visible wording
only**; API field names, role values and database columns (`painter_id`, role `painter`) stay as
they are to avoid a risky rename, and are recorded as known debt for the architect.

Decisions: the field worker is called **"Operative"** in the UI (plural "Operatives"). Job-type
labels stay data-driven. Wording lives in one label module (the existing `format/labels`).

## Scenarios

### 1. No trade-specific words in the chrome
Given the web app
When a test scans UI strings (components, pages, shared labels) and the rendered text of login,
dashboard, reports, report detail, billing, settings and not-authorised pages
Then none contain "painter", "painters", "decorat" or "painting" except job-type labels and
mock-data content

### 2. Labels use Operative
Given the reports list and report detail
Then the column and filter read "Operative" ("All operatives"), the report section reads
"Operative" with "Submitted by", the notes read "Operative notes", and the dashboard rows show
the operative's name

### 3. Demo account labels
Given the login page with demo accounts
Then they read "Manager", "Operative" and "Admin"

### 4. API and URLs unchanged
Given the contract
Then no operation, field, enum value or query parameter changed (`painter_id` still filters), the
generated client is unchanged, and all existing e2e tests pass after updating their text
expectations

### 5. Error and empty states
Given the empty and error states of every page
Then none use the old trade-specific words

## Out of scope
Renaming API fields, enum values or columns; changing job-type enums (T-002m); translating the UI.

## Open questions
- Is "Operative" the right word for Arbour's staff (climbers, groundworkers)? Default: yes, as the
  neutral term; Paul may prefer "Team member" or "Crew". Changing it is one edit in the label
  module.
