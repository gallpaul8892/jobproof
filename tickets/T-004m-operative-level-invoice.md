# T-004m: Operative-level invoice from work done

**Persona:** Operative (invoicing), Subcontractor (manager)
**Depends on:** T-004k, T-004l, T-004i
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); PD1, PD2, Q2, Q12, Q13. No VAT or CIS (Q6).

## Context
The bottom of the invoice tree is the person who did the work. An operative who invoices their
company (many are self-employed) bills quantity done at the rate they were given, tagged to the
jobs. Which role creates the invoice (the operative in the app or the company on their behalf)
is a Paul question; the default is that the company's manager creates it from the recorded work.

## Test data
Aisha Rahman: 60 m done at £6.50 per m on "Riverside Court"; flagged "Invoices: yes".

## Scenarios

### 1. Create from recorded work
Given Aisha has 60 m done, not yet invoiced
When Hannah chooses "Create invoice for Aisha Rahman"
Then a draft invoice is created, level 2 (operative, one below Kessock at level 1), from Aisha to Kessock, with one line
"Riverside Court, external walls, 60 m at £6.50" = £390.00 and total £390.00 (39000 pence)

### 2. Work is never invoiced twice
Given those 60 m are on the draft
When Aisha later records 20 more m and Hannah creates a new draft
Then the new draft has 20 m = £130.00 only, and the 60 m cannot be added to another invoice

### 3. Tagged to the job
Given the draft
Then each line shows job title, site, allocation and quantity, so it can be traced to the job

### 4. Operatives flagged "employed" get no invoice
Given Tom Fenwick is "Employed"
When Hannah tries to create an invoice for him
Then it is refused: "Tom is employed; his work is billed in Kessock's invoice"

### 5. Missing rate
Given an allocation without a rate
When Hannah creates the draft
Then it is refused with "Set a rate for Riverside Court (Aisha) first", listing the allocation

### 6. Nothing to invoice
Given no uninvoiced work
Then "Create invoice" shows "No completed work to invoice" and creates nothing

### 7. Rounding
Given 12.5 m at £6.55 per m
Then the line is £81.88 (81.875 rounded half up once, per line) and the total sums the rounded lines

### 8. Who sees it (money scope: own and direct parent only)
Given the draft
Then Aisha (own) and Kessock's managers see it, and Kessock's Admin sees it read only
And Rowan Finishes, Dunmore and the Contractor (Arbour Services, Aisha's grandparent) do not: by id
the API returns 404 and it appears in no list or total they can see (PD2)

### 8a. Each person's work and invoice side by side
Given Hannah (Kessock) pays Aisha Rahman, Tom Fenwick and Maya Osei
When she opens "Invoices received from my people"
Then each person shows their job, the quantity done and their invoice, so she can pay each one
And the Contractor's view of Kessock shows only Kessock's total and work summary, never these
individual invoices (T-004n)

### 9. Operative sees their invoice in the app
Given Aisha's draft exists
Then the app shows "Invoice: £390.00, draft" read-only; no editing in this ticket

## Out of scope
Operative creating an invoice themselves in the app (default: office creates; Q12), PDF, bank
details, CIS and VAT, adjustments (T-004n).

## Open questions
- Should operatives raise their own invoice in the app? Default: no, manager creates; revisit later.
