# T-002b: Admin persona, server-side authorisation and Settings page shell

**Persona:** Admin
**Owners:** backend-engineer (role, endpoint, seed), frontend-engineer (guard, page)
**Depends on:** T-002a
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decision D2

## Context
The company's administrator configures the product (company name, colour scheme) but does not
review jobs or see billing. Admin is a third role with its own endpoints and its own landing
page. This ticket adds the role, the read endpoint and a read-only Settings page; the edits come
in T-002c and T-002e. Demo accounts: Admin is Tom Ashworth, `admin@jobproof.test`, password
`Admin123!`. A second manager, Priya Nair, `manager2@jobproof.test`, password `Manager123!`, is
added to the seed so two-manager scenarios (T-002g, T-002i) can be tested.

## Scenarios

### 1. Seed has an admin and a second manager
Given the migrated schema with the new role
When `python -m app.seed` runs
Then there are 9 users: 2 managers (Sarah Whitfield, Priya Nair), 6 painters, 1 admin (Tom
Ashworth); only the 2 managers, the demo painter and the admin have password hashes
And the existing 60 jobs, 60 reports, 52 invoices are unchanged, and re-seeding is identical
And the demo accounts list shows the admin and both managers

### 2. Admin signs in and lands on Settings
Given the seeded admin account
When Tom Ashworth signs in on the login page
Then he lands on `/settings`, the header shows "Tom Ashworth" and "Sign out", and `GET
/api/v1/auth/me` returns role `admin`

### 3. Admin endpoints reject everyone else
Given every operation under `/api/v1/admin/` in the contract (enumerated from the YAML)
When each is called with no token, a malformed, expired or wrongly signed token, a deactivated
admin, a manager token or a painter token
Then the first group returns 401 `unauthenticated` and the manager and painter tokens return 403
`forbidden`
And with the admin token it returns 200

### 4. Admin cannot read manager data
Given every operation under `/api/v1/manager/`
When called with the admin token
Then each returns 403 `forbidden`

### 5. Admin reads current settings
Given the admin is signed in
When `GET /api/v1/admin/settings` is called
Then it returns the company name, the theme, `updated_at` and `updated_by` (both null before any
change), validated against the contract

### 6. Settings page shows current values read-only
Given the admin is on `/settings`
Then the page shows the company name "Arbour Services" and the primary and accent colours as
swatches with their hex codes, with no Save button yet
And with the API failing it shows an error state with "Try again", never a blank page

### 7. The web app keeps personas apart
Given the admin is signed in
When he navigates directly to `/`, `/reports`, `/reports/<id>` and `/billing`
Then each shows the "not authorised" page and no request to `/api/v1/manager/` is made
And given a manager or painter is signed in, visiting `/settings` shows the same page and no
request to `/api/v1/admin/` is made
And the header shows the "Settings" link to the admin only, and the Reports and Billing links to
managers only

## Out of scope
Editing settings, user management (create, deactivate, reset passwords), a user holding two roles,
Admin audit viewing.

## Open questions
- Should the Admin also be able to use manager pages? Default: no (separate accounts, D2).
- Who creates Admin accounts in production, given there is no user management? Default: the
  initial Admin is created by a documented command at deployment; user management is a later ticket.
