# T-004a: Company tree and membership; existing data moves under one root

**Persona:** Contractor (Manager today), Admin (of a company)
**Depends on:** T-002b (Admin), T-002f (audit trail)
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); decision Q11 (migration), Q7, PD3

## Context
Today the app has one company (the settings record, D1) and nine flat users. Everything else in
this epic needs a tree of companies with people in them. This ticket adds the tree and puts all
existing data under one root company without changing what anyone sees today, plus a read-only
Companies page.

## Scenarios

### 1. Existing deployment gets one root company
Given the seeded database (9 users, 60 jobs, 52 invoices) and company name "Arbour Services"
When the migration and `python -m app.seed` run
Then there is exactly 1 company, "Arbour Services", at level 0 with no parent
And all 9 users are members of it (2 managers, 6 operatives, and Tom Ashworth holding the Admin
permission of the root company, PD3; he keeps the Settings screens)
And re-running the seed gives the identical result

### 2. Contractor sees the tree
Given Sarah Whitfield (manager) is signed in
When she opens Companies
Then she sees "Arbour Services (Contractor, level 0)" with "6 operatives, 2 managers, 1 admin" listed under it
And Tom Ashworth is listed as "Admin" of Arbour Services

### 3. Empty tree below the root
Given only the root company exists
When the Contractor opens Companies
Then it shows "No subcontractors yet" and an enabled "Add a company" button (built in T-004c)

### 4. A company's Admin sees their own subtree only
Given Tom Ashworth (Admin of Arbour Services) is signed in
When he opens Companies
Then he sees the whole tree, because Arbour Services is the root
And an Admin of a lower company (for example Hannah Kessock, Admin of Kessock) sees only Kessock and
below, with her parent shown as a name only
And adding companies and people from this page is built in T-004c and T-004d

### 5. Existing screens are unchanged
Given the migration has run
When Sarah opens Dashboard, Reports and Billing
Then they show the same 60 reports and 52 invoices as before the migration

### 6. A person is in one company only
Given Dan Hughes is a member of "Arbour Services"
When the API is asked to add him as a member of another company
Then it is refused with 409 `already_a_member` and nothing changes

### 7. Level and name are recorded
Given any company
Then its level is derived from its position (root 0, child of root 1) and cannot be set directly
And company names are unique among siblings (case-insensitive), 409 `name_in_use` otherwise

## Out of scope
Adding companies or people (T-004c, T-004d), authorisation by subtree (T-004b), jobs.

## Open questions
- Answered (PD3): Admin is a permission inside a company, not a separate global account.
