# T-004b: Subtree-scoped authorisation on every endpoint

**Persona:** Subcontractor, Contractor, Operative, Admin (of a company)
**Depends on:** T-004a
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); permissions matrix; PD2, PD3
**Rule (CLAUDE.md):** server-side authorisation on every endpoint, by persona

## Context
The promise to a subcontractor is "you only ever see your own branch", and the promise about money is
stricter: you see only your own invoices and your immediate children's. One missed filter breaks
trust with every company in the tree. This ticket makes both scoping rules the same everywhere and
proves them by test before any new feature relies on them. Used by every later ticket.

There are **two scopes**, and tests must keep them apart:
- **Progress and structure scope:** own company and the whole subtree below it (any depth).
- **Money scope (rates and invoices):** own company and its **direct children** only.

## Test data (from T-004e, or built by the test itself)
Call them A, B, C as Paul does. A = Arbour Services (L0, Contractor, manager Sarah Whitfield, Admin
Tom Ashworth). B = "Kessock Decorating Ltd" (L1, manager and Admin Hannah Kessock). C = "Rowan
Finishes" (L2, under Kessock, manager and Admin Ravi Patel). Sibling of B: "Dunmore Painters" (L1,
manager Colm Dunmore). Operatives: Aisha Rahman (Kessock) and Jess Lowry (Rowan Finishes). Money:
Rowan to Kessock invoice £1,020.00 (INV-L2-010) at rate £7.00 per m; Kessock to Arbour invoice
£1,380.00 (INV-L1-002) at rate £8.00 per m; Dunmore to Arbour invoice £2,100.00.

## Scenarios

### 1. A subcontractor sees only their subtree
Given Hannah Kessock is signed in
When she lists companies, people, reports and jobs
Then she sees Kessock and Rowan Finishes and their people and work only
And Dunmore Painters, its people and its reports never appear

### 2. Direct access to a sibling is refused
Given the id of a Dunmore report, job, person and company
When Hannah requests each by id
Then each returns 404 `not_found` (not 403, so existence is not leaked)

### 3. A parent's other data is not visible
Given Ravi Patel (Rowan Finishes) is signed in
When he lists companies
Then he sees Rowan Finishes and its people; the parent "Kessock Decorating Ltd" is shown as a name
only, with no people, jobs, rates or invoices

### 4. The Contractor sees structure and progress at every depth
Given Sarah Whitfield is signed in
When she lists companies, reports and jobs
Then she sees all levels (Kessock, Dunmore, Rowan Finishes and below)

### 5. A cannot read C's invoices or rates (grandchild)
Given Sarah Whitfield (A) is signed in
When she requests Rowan Finishes' invoice INV-L2-010 (£1,020.00), any invoice from Aisha Rahman or
Jess Lowry, or the rate Kessock gave Rowan (£7.00 per m) by id
Then each returns 404 `not_found`
And no list of invoices, allocations, jobs or progress returned to her contains a Rowan-level or
deeper amount, rate or invoice number (the response field is absent, not hidden in the UI)
And she can read Kessock's invoice INV-L1-002 (£1,380.00) and the £8.00 rate she gave Kessock

### 6. B cannot read A's invoices or rates (parent)
Given Hannah Kessock (B) is signed in
When she requests Arbour's customer invoice, Dunmore's invoice to Arbour (£2,100.00), or the rate
Arbour gave Dunmore, by id
Then each returns 404
And she can read her own invoice to Arbour, her own rate from Arbour (£8.00), and the invoices and
rates of her direct children (Rowan Finishes £1,020.00 at £7.00, and each of her operatives)

### 7. Siblings see nothing
Given Colm Dunmore (a sibling of Kessock) is signed in
When he requests any Kessock or Rowan invoice, rate, allocation, progress row or person by id, or
lists them
Then each by-id request returns 404 and no list contains any of them
And the same holds the other way round for Hannah and Dunmore data

### 8. Progress scope is wider than money scope
Given Sarah (A) opens the job "Repaint external walls, Riverside Court, Leeds"
When she views progress
Then she sees units done and allocated for Kessock, Rowan Finishes and the operatives below
(for example Jess Lowry 90 of 150 m) and no rate, price or invoice amount on any of those rows

### 9. Review is limited to the reviewer's subtree
Given a report by an operative of Rowan Finishes
When Ravi Patel marks it reviewed
Then it succeeds; and when Colm Dunmore tries, it returns 404
And when Hannah Kessock (an ancestor) or Sarah Whitfield marks it reviewed, it succeeds

### 10. Operatives are limited to their own work
Given Dan Hughes (operative) is signed in
When he calls any manager, company or admin endpoint
Then each returns 403 `forbidden`

### 11. Admin is scoped to their company
Given Hannah is Admin of Kessock and Tom Ashworth is Admin of Arbour Services (neither is asked to
act as a manager here)
When Hannah, as Admin, requests progress or invoices for Dunmore Painters, or Arbour's customer
invoices
Then each returns 404
And when Tom requests Rowan's invoice INV-L2-010 he gets 404 (the same money scope as Sarah)
And an Admin who is not also a manager gets 403 on `/manager/reports/{id}` (T-002b scenario 4)

### 12. Whole-contract test
Given every operation in `/api/openapi.yaml`
When called as each role at each level (Contractor, Subcontractor L1 and L2, Operative, Admin of
L0 and L1, no token)
Then the result matches the permissions matrix in T-004 exactly and the test fails if a new
operation is not listed in the matrix
And for every operation that returns money (rate, invoice, line, total), the test checks it for
the money scope (own and direct children) separately from the progress scope (whole subtree)

### 13. Deactivated company
Given "Dunmore Painters" is deactivated
When any Dunmore user signs in or uses an existing token
Then they get 401 `unauthenticated`; their historical data remains visible to ancestors within the
scopes above (progress to all ancestors, money to the direct parent only)

## Out of scope
Rate and invoice features themselves (T-004k to T-004p), which must pass these tests; Admin
progress and invoice screens (T-004j, T-004p).

## Open questions
- Is 404 vs 403 for other branches acceptable? Default: 404 for other branches, 403 for wrong role.
