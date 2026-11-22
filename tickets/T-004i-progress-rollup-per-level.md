# T-004i: Progress rollup at every level

**Persona:** Contractor, Subcontractor (manager)
**Depends on:** T-004h
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); PD3 (progress goes down the whole subtree)

## Context
When operatives tick off work, each level wants "how much of mine is done". The numbers are always
derived from what the operatives recorded, never typed in higher up, so they cannot disagree.

## Test data
Job "Repaint external walls, Riverside Court, Leeds" 2,000 m. Kessock 1,000 m (Aisha 100 m with 60 m
done, Tom Fenwick 100 m with 100 m done, Rowan Finishes 600 m with 140 m done, 200 m not yet
allocated). Dunmore 1,000 m with 0 done.

## Scenarios

### 1. Each level sees its own progress
Given the data above
When Hannah opens the job
Then Kessock shows "300 of 1,000 m done (30%)" and its rows show Aisha 60 of 100, Tom 100 of 100,
Rowan 140 of 600 and "200 m not yet allocated"

### 2. The Contractor sees the whole job, to every depth
Given Sarah opens the job
Then it shows "300 of 2,000 m done (15%)", Kessock 300 of 1,000, Dunmore 0 of 1,000
And she can expand Kessock to Rowan Finishes (140 of 600) and on to Jess Lowry and the other
operatives, because progress goes down the whole subtree (PD3)

### 3. Sums always add up
Given any job in the seed
Then for every allocation, done = sum of its children's done plus any done recorded directly on it,
and no level shows more done than allocated

### 4. Siblings stay private
Given Colm Dunmore opens the job
Then he sees only "0 of 1,000 m" for Dunmore and nothing about Kessock

### 5. Updates flow up
Given Aisha records 10 more metres (70 of 100)
When Hannah and Sarah refresh
Then Kessock shows 310 of 1,000 m and the job 310 of 2,000 m

### 6. Re-assignment keeps totals
Given 40 m is moved from Aisha to Maya (T-004g)
Then no level's done total changes

### 7. Empty states
Given a job with no allocation yet
Then it shows "0 of 2,000 m done, nothing allocated"
And a company with an allocation but no operatives yet shows "0 of 1,000 m, not yet allocated to people"

### 8. Dashboard
Given Hannah opens her Dashboard
Then it lists her jobs with a progress bar and "300 of 1,000 m"; for whole-job units it shows "1 of 3 jobs done"

### 9. Progress carries no money
Given any progress page or API response, for Sarah, Hannah or any Admin
Then it shows units done and allocated only: no rate, value, price or invoice amount on any row,
at any depth (money follows the tighter direct-children rule, T-004k and T-004b)

### 10. Operatives' work rolls up through the levels
Given Jess Lowry (Rowan Finishes) records 10 more metres
Then Rowan Finishes, Kessock and the job at Arbour Services each increase by 10 m done, and
Hannah and Sarah see it without seeing Jess's rate or invoice

## Out of scope
Deadlines and late warnings, charts over time, notifications, forecasting.

## Open questions
- Do reports and their review status affect progress? Default: no; progress counts recorded
  quantity even if the report is awaiting review.
