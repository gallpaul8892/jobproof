# T-002c: Admin sets the company name; it shows in the header, page title and login

**Persona:** Admin (and everyone who sees the app)
**Owners:** backend-engineer (PATCH), frontend-engineer (form, header, title, login)
**Depends on:** T-002a, T-002b
**Part of:** [T-002](T-002-admin-branding-review-workflow.md)

## Context
Each company wants the app to carry its own name. The default is "Arbour Services"; the Admin can
change it. The name appears in the header, the browser tab title and the login page, for every
persona. Changes take effect on the next page load, with no redeploy.

## Scenarios

### 1. Admin changes the company name
Given the admin is on `/settings`
When he enters "Arbour Tree Care Ltd" and presses Save
Then he sees "Settings saved", `GET /api/v1/branding` returns "Arbour Tree Care Ltd", and the
settings show `updated_by` Tom Ashworth and a fresh `updated_at`

### 2. The name appears in the header and tab title
Given the name is "Arbour Tree Care Ltd"
When a manager signs in and opens Reports, then a report
Then the header shows "Arbour Tree Care Ltd" on every page and the browser tab title is
"Reports | Arbour Tree Care Ltd" and "Report JP-1042 | Arbour Tree Care Ltd" (job reference as
in the data)

### 3. The name appears on the login page
Given nobody is signed in
When anyone opens `/login`
Then the page shows "Arbour Tree Care Ltd" as its heading and the tab title is
"Sign in | Arbour Tree Care Ltd"
And before the name has loaded no other company's name flashes (the brand area is empty or a
skeleton until `/branding` answers)

### 4. Branding failure does not block sign-in
Given `GET /api/v1/branding` fails
When someone opens `/login`
Then the heading is the neutral text "Sign in", the tab title is "Sign in", the form works, and a
later successful load shows the company name

### 5. Validation
Given the Settings form
When the admin saves a name that is empty or only spaces, longer than 60 characters, or contains
a control character or NUL
Then the API returns 422 `validation_error` with an `errors` entry for `company_name`, the page
shows the message beside the field, and nothing is saved
And leading and trailing spaces in a valid name are trimmed before saving

### 6. Names are shown as plain text
Given the admin saves the name `<script>alert(1)</script> & Sons`
Then the header, title and login show exactly that text, escaped, and no script runs

### 7. Only the Admin can change it
Given a manager token, a painter token and no token
When each calls `PATCH /api/v1/admin/settings` with a new name
Then they get 403, 403 and 401, and the name is unchanged

### 8. Form states
Given the Settings page
Then Save is disabled while the name is unchanged or invalid; while saving it shows a progress
state; a failed save (500 or network) shows an error with the typed value kept and a "Try again"

## Out of scope
Colour scheme (T-002e), logo, a different name per page, the audit entry for this change
(T-002f adds it).

## Open questions
- Is the tab title format "Page | Company" acceptable? Default: yes.
