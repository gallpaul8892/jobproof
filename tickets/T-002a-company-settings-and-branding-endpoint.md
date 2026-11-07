# T-002a: Company settings record and public branding endpoint

**Persona:** Developer (internal), on behalf of Admin
**Owner:** backend-engineer (architect designs the schema and contract first)
**Depends on:** T-001c
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decision D1

## Context
The product will serve several companies with different names; the first is Arbour Services.
The simplest approach that does not block multi-tenancy later: **one deployment per company**,
with the company name and colour scheme in a **single settings record** read through one
accessor (decision D1 in T-002). This ticket creates that record, its default values and a public
read endpoint the login page can use before anyone signs in. Nothing is editable yet (T-002c,
T-002e).

The default theme is one object: primary `#1F5130` (dark green: header, primary buttons),
accent `#2F5D3A` (dark green: links, focus ring), background `#FFFFFF`, surface `#F4F7F2`,
text `#1B1F1C`. Contrast against white: primary 9.22:1, accent 7.64:1, text 16.68:1.

## Scenarios

### 1. A fresh deployment has default settings
Given an empty database
When `alembic upgrade head` runs (no seed)
Then there is exactly one company settings record with company name "Arbour Services" and the
default theme above
And running the seed afterwards does not change or duplicate it

### 2. The default company name can be set per deployment
Given the environment variable for the default company name is set to "Oakfield Joinery" when the
migration runs on an empty database
Then the settings record's company name is "Oakfield Joinery" and the theme is the default theme

### 3. Public branding endpoint
Given the stack is running and no token is sent
When `GET /api/v1/branding` is called
Then it returns 200 with `company_name` "Arbour Services" and the theme (primary, accent,
background, surface, text as `#RRGGBB`), validated against the contract
And the response contains nothing else (no user, version or internal id) and has
`Cache-Control: no-cache`

### 4. Only one settings record can exist
Given the migrated schema
When a test inserts a second settings record
Then the insert fails with an integrity error

### 5. No company-specific values are scattered through the code
Given the repository
When a test scans backend, shared and web source (excluding seed data, tests, docs and the one
defaults module)
Then the strings "Arbour" and the default theme hex codes appear nowhere else, and company name
and theme are read only through the settings accessor

### 6. Stored colours are always valid
Given the migrated schema
When a test inserts a theme colour that is not `#RRGGBB`
Then the insert fails with an integrity error

## Out of scope
Editing settings (T-002c, T-002e), the Admin role (T-002b), logo, favicon, per-company domains,
a tenant table.

## Open questions
- Logo: do Arbour have one to show next to the name? Default: text name only, no logo.
- Should the product name "JobProof" appear anywhere in the UI? Default: no (white label).
