# T-004f: Split a job down the hierarchy (allocations with quantity and unit)

**Persona:** Contractor, Subcontractor (manager)
**Depends on:** T-004e
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q3 (over-allocation), Q9 (units), Q11

## Context
The work stays the same; it is divided. A building-site job of 2,000 m is split by the contractor
into 1,000 m for each of two subcontractors; each splits its share into smaller pieces for its own
people or companies. A manager needs to see at a glance what is split and what is left.

## Scenarios

### 1. A job has a quantity and unit at the top
Given Sarah creates or edits the root job "Repaint external walls, Riverside Court, Leeds"
When she sets quantity 2000 and unit "m"
Then the job shows "2,000 m, 0 m allocated, 2,000 m not yet allocated"
And existing jobs from the seed show "1 whole job" (Q11)

### 2. Contractor splits between two subcontractors
Given the job above
When Sarah allocates 1000 m to "Kessock Decorating Ltd" and 1000 m to "Dunmore Painters"
Then the job shows 2,000 of 2,000 m allocated and two allocations of 1,000 m, each with its assignee

### 3. Subcontractor splits further, to people
Given Kessock holds 1,000 m
When Hannah allocates 100 m each to Aisha Rahman and Tom Fenwick
Then Kessock's allocation shows "200 m allocated, 800 m not yet allocated"
And Sarah sees the same nested split; Colm Dunmore sees none of it

### 4. Over-allocation is blocked
Given Kessock has allocated 1,000 of 1,000 m
When Hannah allocates 50 m more to Maya Osei
Then it is refused: "Only 0 m left to allocate" and nothing is saved

### 5. Same unit all the way down
Given the job unit is "m"
When Hannah creates an allocation
Then the unit is shown as "m" and cannot be changed

### 6. Quantity rules
Given the allocation form
When quantity is 0, negative, or has 3 decimal places ("12.345")
Then it is refused with a field error; "12.5" is accepted

### 7. Split to a company or to a person
Given Hannah's allocation form
Then the assignee list contains only Kessock's operatives and its direct child companies,
never Dunmore, Arbour or the Contractor's people

### 8. Not by operatives
Given Dan Hughes
Then he has no "Split" control and the API returns 403

### 9. Audited
Given an allocation is created
Then the audit trail records who, when, quantity, unit, assignee and the parent allocation

## Out of scope
Rates (T-004k), changing or removing allocations (T-004g), progress (T-004i), tasks per allocation
(the checklist is shared), deadlines per allocation, unit conversion.

## Open questions
- Is one level of nesting always a direct child (no skipping levels)? Default: yes, a company
  allocates only to itself, its direct people or its direct child companies.
