# T-004j: A company's Admin sees progress across its own subtree

**Persona:** Admin (of a company)
**Depends on:** T-004i, T-004b
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); PD3 (replaces T-002 D2). File name kept for stable links; it is no longer a global "all levels" view.

## Context
Admin is a permission in one company (PD3). A company's Admin can see the progress of that company's
jobs: how many units are done against allocated, across **every depth below it**, rolled up from the
operatives. It cannot see another branch or anything above. Progress carries **no prices** (money
follows a different, tighter rule, PD2). Read-only; no photos, report text or customer contacts.

## Scenarios

### 1. The root company's Admin sees progress for every job and level
Given Tom Ashworth (Admin of Arbour Services) is signed in and the T-004i test data exists
When he opens Progress
Then he sees job "Repaint external walls, Riverside Court, Leeds" at "300 of 2,000 m" and can expand
Kessock (300 of 1,000), Rowan Finishes (140 of 600), and Aisha Rahman (60 of 100), and deeper
(Jess Lowry, and so on), each as units done against units allocated, with no rate or amount

### 2. A subcontractor's Admin sees only their subtree
Given Hannah Kessock (Admin of Kessock) is signed in
When she opens Progress
Then she sees Kessock (300 of 1,000 m) and below (Aisha, Tom Fenwick, Rowan Finishes and its people)
And Dunmore Painters, its progress and the job's 2,000 m total do not appear; the parent shows as a name only

### 3. Another branch's Admin sees nothing of it
Given Colm Dunmore (Admin of Dunmore Painters)
When he requests Kessock's progress by id
Then it returns 404, and his own Progress shows only "0 of 1,000 m" for Dunmore

### 4. Filter by level and company
When Tom filters to Level 2
Then only level 2 allocations in his subtree appear with their done and allocated quantities

### 5. Read-only
Given the Progress pages
Then there are no edit, allocate or re-assign controls and every write endpoint returns 403 for an
Admin who is not also a manager

### 6. What Admin still cannot see
Given Tom opens a job's progress
Then there are no photos, report text, customer contact details or rates, and
`/manager/reports/{id}` still returns 403 for an Admin who is not also a manager (T-002b scenario 4)

### 7. Others cannot use it
Given Dan Hughes (operative) or a user without Admin
When they call the Admin progress endpoints
Then each returns 403

### 8. Empty state
Given no allocations exist
Then it shows "No work has been split yet"

## Out of scope
Exporting, dashboards, editing the tree from this screen, rates and invoices (T-004k, T-004p),
managers' own progress views (T-004i).

## Open questions
- Should Admin see customer name on the progress rows? Default: job title and site town only.
