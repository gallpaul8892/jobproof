# T-004n: Company invoice rolled up from the invoices below

**Persona:** Subcontractor (manager), Contractor
**Depends on:** T-004m
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); PD1, PD2, Q2, Q5, Q18

## Context
Paul's example: 3 workers' invoices roll up into one invoice for their subcontractor company; that
company plus 4 other subcontractors (5) each send an invoice, tagged to the jobs, to the main
contractor, so the company gets paid. Each level's invoice is **its own work plus the invoices of
the level below** (PD1), with no double counting. Visibility is strict (PD2): the parent sees what
the child wants to be paid and a summary of the work done, never what the child pays its own
children. The top contractor groups all its direct subcontractors' invoices into one report and
invoice for the customer.

## Test data
Kessock: Aisha invoice INV-L2-001 £390.00, Tom Fenwick (employed, own lines 100 m at £6.50 = £650.00),
Maya Osei invoice £260.00, Rowan Finishes (L2) invoice £1,020.00. Arbour has 5 L1 subcontractors.

## Scenarios

### 1. Build a rollup from approved invoices below
Given Aisha's £390.00 and Maya's £260.00 invoices are approved (T-004o)
When Hannah creates "Invoice to Arbour Services"
Then the draft is level 1, from Kessock to Arbour, with one line per included invoice
(INV-L2-001 £390.00, INV-L2-003 £260.00), total £650.00 (65000 pence), each line tagged to its jobs

### 2. Own work plus invoices from below
Given Tom Fenwick is employed with 100 m done at £6.50
Then Hannah can add "Own work: Riverside Court, 100 m at £6.50 = £650.00" and the total is £1,300.00

### 3. Adjustment line (margin or deduction)
When Hannah adds "Management and materials +£120.00" and "Late finish -£40.00"
Then the total shows £1,380.00, each adjustment has a required description, and both are audited

### 4. Only approved, only direct children, only once
Given a draft (unapproved) invoice, a grandchild's invoice and an invoice already used in another rollup
When Hannah looks at the "Include" list
Then none of them is offered; only approved, unused invoices from Kessock's direct children appear

### 5. No double counting
Given Rowan's £1,020.00 invoice includes Jess Lowry's work
Then Kessock's invoice shows Rowan's one line, and cannot also bill the same work as Kessock "own work"
(the API refuses with "This work is already invoiced")

### 6. Rate check, not a block
Given Arbour agreed £8.00 per m with Kessock and 300 m is done
Then beside the total the page shows "Agreed rate x done: £2,400.00; this invoice £1,380.00;
difference -£1,020.00", a warning only, and issuing is still allowed
And the check uses only rates the viewer may see (Hannah: her rate from Arbour; Sarah: her rate to Kessock)

### 7. Five subcontractors, one contractor total
Given 5 L1 companies each have an approved level 1 invoice
When Sarah opens Billing, "Invoices received"
Then she sees 5 invoices (one per subcontractor) and their sum; she does not see any level 2 or deeper invoice

### 7a. The Contractor groups its subcontractors into one customer report
Given the 5 approved level 1 invoices above (Kessock £1,380.00, Dunmore £2,100.00 and three others)
When Sarah chooses "Create customer invoice" for "Riverside Court, Leeds"
Then the draft level 0 invoice includes those 5 invoices whole, plus any own work and adjustments she adds,
and a "Subcontractor roll-up" report lists each subcontractor's invoice total and a work summary
(job, units done) for her own use
And the customer-facing invoice shows job-level lines and the total, with no subcontractor name or
amount (default, Q18)
And no level 2 or deeper amount appears anywhere in it

### 8. A parent sees the total and a work summary, not what is inside
Given Sarah opens Kessock's £1,380.00 invoice
Then she sees what Kessock wants to be paid (£1,380.00) and a job-by-job summary of the work done
("Riverside Court external walls, 300 m"), and any adjustment lines Kessock added
And she does not see which lines came from Aisha, Maya or Rowan Finishes, their invoice numbers,
names, rates or amounts, nor how many invoices were included, nor what Kessock pays them (PD2)
And Hannah sees everything, including each child's invoice in full ("Invoices received from my people")

### 9. Rollup totals are exact
Given any rollup
Then total = sum of line amounts in integer pence, and a test asserts it for every seeded rollup

### 10. Nothing to invoice
Given no approved invoices and no own work
Then "Create invoice" says "Nothing to invoice yet"

## Out of scope
Automatic generation, retention, VAT, CIS, PDFs, partial inclusion of a child invoice (a child invoice
is included whole or not at all).

## Open questions
- Does the customer see each subcontractor's name and amount? Default: no, job-level lines and total (Q18).
- Adjustment lines and retention: Default as Q2 (adjustments yes, retention out).
