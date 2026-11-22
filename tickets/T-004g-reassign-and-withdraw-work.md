# T-004g: Re-assign or withdraw unfinished quantity

**Persona:** Contractor, Subcontractor (manager)
**Depends on:** T-004f (and T-004h for the "work already done" scenarios)
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q4

## Context
Plans change: an operative is off sick, a subcontractor walks away. Managers must move work without
losing what is already done, because done quantity is what gets invoiced.

## Scenarios

### 1. Re-assign an untouched allocation
Given Aisha Rahman holds 100 m with 0 m done
When Hannah re-assigns it to Maya Osei
Then Maya holds 100 m and Aisha no longer sees it

### 2. Re-assign only the unfinished part
Given Aisha holds 100 m with 60 m done
When Hannah moves the remainder to Maya
Then Aisha's allocation becomes 60 m (60 done, complete) and Maya gets a new allocation of 40 m
And the totals stay 100 m

### 3. Withdraw unfinished quantity
Given Aisha holds 100 m with 60 m done
When Hannah withdraws the remainder
Then Aisha's allocation becomes 60 m and Kessock shows 40 m more "not yet allocated"

### 4. Cannot take back done work
Given 60 m is done
When Hannah tries to reduce the allocation below 60 m
Then it is refused: "60 m is already done and can't be removed"

### 5. Reduce a company's allocation that has been passed down
Given Kessock gave 800 m to Rowan Finishes who passed on 500 m
When Hannah tries to reduce Rowan's allocation to 400 m
Then it is refused: "Rowan has passed on 500 m; withdraw that first"

### 6. Only the allocator
Given Colm Dunmore, or Ravi Patel (below)
When either tries to re-assign Kessock's allocation to Aisha
Then it is refused with 404 (not their branch) or 403 (not the allocator)

### 7. In-flight operative app
Given Aisha has the allocation open on her phone offline with 10 m recorded
When Hannah moves the remainder to Maya and Aisha syncs
Then her recorded 10 m is kept and counted; the app shows "Re-assigned to your office" for the rest

### 8. Audited
Every move or withdrawal records who, when, quantity, from and to.

## Out of scope
Moving a company to another parent, re-assigning invoiced work (refused, see T-004m), bulk moves.

## Open questions
- Can an allocation be re-assigned after the operative's invoice is issued? Default: no for the
  invoiced part.
