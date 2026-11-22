# T-004h: Operative sees and ticks off an allocation

**Persona:** Operative
**Depends on:** T-004f, T-003c, T-003d, T-003h (the app must be able to submit reports first)
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q10, Q13. The only ticket that
changes the Operative app.

## Context
The operative does not care about the tree. They want "my 100 m at Riverside Court" and a quick way
to say how much is done. The existing completion report stays the evidence; quantity done is
recorded alongside it.

## Scenarios

### 1. My jobs lists my allocations
Given Aisha Rahman holds 100 m of "Repaint external walls, Riverside Court, Leeds"
When she opens My jobs today
Then she sees the job with "100 m to do, 0 m done" and the site address, as in T-003c

### 2. What she does not see
Given Aisha opens the job
Then she sees description, address, checklist, customer contact for the site (T-003 Q11), "Allocated
by Kessock Decorating Ltd"; she does not see rates, other companies, other operatives, or the 2,000 m total

### 3. Record partial progress
Given 0 m done
When Aisha enters 60 and taps "Save progress"
Then it shows "60 of 100 m done"; Hannah (web) sees 60 m on Aisha's allocation after sync

### 4. Complete the allocation
Given 60 of 100 m done
When Aisha enters 100 (or taps "Mark complete" after the other required items)
Then it shows "100 of 100 m, complete" and the completion report can be submitted (T-003h)

### 5. Cannot exceed the allocation
Given 100 m allocated
When Aisha enters 120
Then it refuses: "You can record up to 100 m"

### 6. Correct a mistake
Given 60 m saved by mistake (should be 50)
When Aisha enters 50 before her invoice is created
Then it shows 50 and the change is audited with old and new values; after an invoice includes the
work, the field is read-only with "Ask your office to change this" (Q13)

### 7. Offline
Given airplane mode
When Aisha records 30 m
Then it is stored on the phone, shown as "Not yet sent", and reaches the office on sync without
duplicates (T-003i, T-003j idempotency)

### 8. Someone else's allocation
Given Aisha
When she requests Tom Fenwick's allocation by id
Then it returns 404

### 9. Jobs without a quantity
Given an existing job with unit "whole job"
Then Aisha sees "Whole job" with a Done / Not done choice, as before

## Out of scope
Photos per metre, measuring tools, time or materials, editing the allocation, the invoice (T-004m).

## Open questions
- Can operatives allocate to a colleague on site? Default: no; managers only.
