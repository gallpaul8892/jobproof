# T-004k: Rate per unit set by the allocator, and who sees which price

**Persona:** Contractor, Subcontractor (manager), Admin (read only, own company)
**Depends on:** T-004f, T-004b
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); PD1, PD2, PD3. Money is integer pence GBP.

## Context
Every hand-down of work has an agreed price per unit, for example £8.00 per m from the Contractor
to Kessock, and £6.50 per m from Kessock to Aisha. **The company that makes the split sets the
rate** (PD1). Each company's margin is its own business, so rates are visible only between a
company and its **direct children**, and a company sees the rate it was given by its parent. Nobody
sees what anyone else charges the customer or pays the workers (PD2). This is a different, tighter
rule than progress, which goes down the whole subtree (PD3).

## Scenarios

### 1. Set a rate when allocating
Given Hannah allocates 100 m to Aisha Rahman
When she enters rate "6.50" per m
Then the allocation shows "£6.50 per m" and the value "£650.00 if all done" (stored as 650 pence per m)

### 2. Rate is optional until work is invoiced
Given an allocation with no rate
Then it can be saved, shows "Rate not set", and an invoice including it cannot be created (T-004m)

### 3. A company sees its own rate and its direct children's rates only
Given Contractor to Kessock £8.00, Kessock to Aisha £6.50, Kessock to Rowan £7.00, Rowan to Jess £5.80
When Hannah opens the job
Then she sees £8.00 (hers from Arbour), £6.50 (Aisha) and £7.00 (Rowan), and not £5.80 (a grandchild's)

### 4. A subcontractor does not see what is above or beside
Given Ravi Patel (Rowan Finishes)
Then he sees £7.00 (his own rate from Kessock) and £5.80 (Jess), and not £8.00 or Aisha's £6.50
And Colm Dunmore sees none of Kessock's or Rowan's rates, and Hannah sees none of Dunmore's

### 5. The Contractor sees only its direct children's rates
Given Sarah
Then she sees £8.00 for Kessock and Dunmore's rate, and not £6.50, £7.00 or £5.80
And no rate is shown on any progress row she opens (progress shows units only, T-004i)

### 6. Operatives see no rate
Given Aisha opens her allocation in the app
Then no rate or value is shown, and the API response contains no rate field for her

### 7. A company's Admin sees what its managers see, read only
Given Tom Ashworth (Admin of Arbour Services) and Hannah (Admin of Kessock)
Then Tom sees the same rates as Sarah (£8.00 for Kessock and Dunmore's rate) and Hannah sees the
same as in scenario 3, both read only
And neither sees a rate outside their own company and its direct children

### 8. Changing a rate
Given an allocation with 60 m done and not yet invoiced
When Hannah changes the rate from 6.50 to 6.75
Then it applies to future invoices; the change is audited with old, new, who and when
And once the work is on an issued invoice, that invoice keeps its old rate (immutable)

### 9. Validation
Given the rate field
When it is negative, over £1,000.00 per unit or has more than 2 decimal places
Then it is refused with a field error; "0.00" is allowed with a warning "No charge"

### 10. The rate check warns and never blocks
Given Arbour agreed £8.00 per m with Kessock and 300 m is done (agreed £2,400.00)
When Kessock's invoice total is £1,380.00
Then the rate check beside the total shows "Agreed rate x done: £2,400.00; this invoice £1,380.00;
difference -£1,020.00" as a warning, and the invoice can still be submitted and issued (see T-004n)
And the check uses only rates the viewer may already see (own rate, direct children's rates)

## Out of scope
Day rates and time-based pay, rate cards, bonuses, retention, VAT, CIS deductions.

## Open questions
- Does an operative see their own rate? Default: no (Q1a).
