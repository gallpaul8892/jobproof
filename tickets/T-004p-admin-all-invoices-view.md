# T-004p: A company's Admin sees its own and its direct children's invoices

**Persona:** Admin (of a company)
**Depends on:** T-004o, T-004b
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); PD2, PD3 (replaces T-002 D2). File name kept for stable links; it is no longer an "all invoices" view.

## Context
Admin is a permission in one company, not a global role (PD3). A company's Admin may be technical or
office staff, not a manager, so this is a **read-only** view: no editing, approving or issuing
(default, Q17). The visibility is the money rule (PD2): the company's own invoices plus the invoices
of its **immediate children**, and nothing deeper or sideways.

## Test data
A = Arbour Services (Admin Tom Ashworth). B = Kessock Decorating Ltd (Admin Hannah Kessock). C =
Rowan Finishes (Admin Ravi Patel). Invoices: level 0 customer invoices; level 1 Kessock to Arbour
£1,380.00 and Dunmore to Arbour £2,100.00; level 2 Rowan to Kessock £1,020.00 and Aisha to Kessock
£390.00; level 3 Jess Lowry to Rowan £290.00.

## Scenarios

### 1. Own and direct children's invoices only
Given Tom Ashworth (Admin of Arbour Services) opens Invoices
Then he sees Arbour's level 0 customer invoices and the level 1 invoices from Kessock (£1,380.00) and
Dunmore (£2,100.00), each with number, level, issuer, addressee, status and total, newest first
And he does not see Rowan's £1,020.00, Aisha's £390.00 or Jess's £290.00 anywhere

### 2. A subcontractor's Admin sees one level less
Given Hannah Kessock (Admin of Kessock) opens Invoices
Then she sees Kessock's invoice to Arbour (£1,380.00) and the invoices from her direct children
(Rowan £1,020.00, Aisha £390.00), and not Jess Lowry's £290.00, Arbour's customer invoices or Dunmore's

### 3. Filter by level, company and status
When Tom filters level 1, or company "Kessock Decorating Ltd", or status "issued"
Then only matching rows within his scope show and the count and total update

### 4. Open an invoice
Given Tom opens Kessock's £1,380.00 invoice
Then he sees what Kessock wants to be paid and the job-by-job work summary (T-004n scenario 8), and
no line, name or amount from Kessock's own children
And when Hannah opens Rowan's £1,020.00 invoice (a direct child) she sees its lines in full

### 5. Totals reconcile
Given any invoice in scope
Then the page shows "Lines sum to £1,380.00; invoice total £1,380.00" and a visible "Mismatch" badge
if they ever differ (never expected; a test asserts none exist in the seed)

### 6. Read-only
Given any invoice page
Then there are no approve, issue, edit or credit controls, and each such API call returns 403 for an
Admin who is not also a manager

### 7. Limits
Given Tom opens an invoice
Then he sees the customer name but no contact details, photos or report text (unless he is also a manager, Q16)

### 8. Out of scope invoices are not reachable
Given Tom requests Rowan's invoice or Jess's invoice by id
Then each returns 404, the same as for Sarah (T-004b scenario 5)

### 9. Others cannot use it
Given Dan Hughes (operative) or a user without Admin
When they call the Admin invoice endpoints
Then each returns 403 (managers use their own scoped Billing, T-004b and T-004l)

### 10. Empty state
Given no invoices in scope
Then "No invoices yet"

## Out of scope
Export to CSV or accounting software, charts, audit-log view, payments, any view of invoices
beyond direct children (withdrawn by PD2).

## Open questions
- Does Admin need CSV export of invoices? Default: no.
- May an Admin approve or issue? Default: no (Q17).
