# T-004e: Demo company tree seed, four levels deep

**Persona:** Contractor, Subcontractor, Admin (and testers)
**Depends on:** T-004d
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q11
**Convention (CLAUDE.md):** mock data is realistic UK painting and decorating data, no network

## Context
Every later scenario needs a believable tree. The seed gives demos and tests one fixed tree on top
of the migrated data (T-004a), without changing the existing 60 jobs and 52 invoices.

## Scenarios

### 1. The seeded tree
Given `make seed` runs on an empty database
Then the tree is
- Arbour Services (L0): Sarah Whitfield, Priya Nair (managers); Tom Ashworth (Admin, with Settings); 6 existing operatives incl. Dan Hughes
- Kessock Decorating Ltd (L1): Hannah Kessock (manager and Admin); operatives Aisha Rahman, Tom Fenwick, Maya Osei
- Dunmore Painters (L1): Colm Dunmore (manager and Admin); 2 operatives
- Rowan Finishes (L2, under Kessock): Ravi Patel (manager and Admin); operatives Jess Lowry, Callum Reid, Nadia Qureshi
- Aldous Decorators (L3, under Rowan): sole trader Peter Aldous (manager and operative)
- Brightwell Interiors (L1): manager and one operative, no children (an empty branch for tests)

### 2. Demo sign-ins
Given the demo accounts list on the login page
Then it lists Sarah (Contractor), Hannah (Subcontractor L1), Ravi (Subcontractor L2), Dan Hughes
(Operative at L0), Aisha Rahman (Operative at L1) and Tom Ashworth (Admin of the root company), with passwords

### 3. Re-seed is identical and idempotent
Given the seed has run
When it runs again
Then ids, names and counts are identical

### 4. Existing data unchanged
Given the seed has run
Then the 60 jobs, 60 reports and 52 invoices of earlier tickets are unchanged and still visible to Sarah

### 5. Seeded work and invoices come later
Given this ticket is done
Then the tree has no allocations and no tiered invoices; T-004f, T-004i and T-004n extend the seed
with their own data and each extension is idempotent

## Out of scope
Real company names; production data.

## Open questions
None.
