# T-004o: Approval, issue, immutability and credit notes

**Persona:** Subcontractor (manager), Contractor
**Depends on:** T-004n; relies on B12 (snapshot) from ARCHITECTURE.md
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q5

## Context
Invoices are evidence of who is owed what. Once sent they must not change, and a parent should
approve what it is about to be billed. Invoice states for this epic: draft, submitted (to parent),
approved, issued, void (credit-noted).

## Scenarios

### 1. Submit to the parent
Given Hannah has a draft invoice for £650.00
When she chooses "Submit to Arbour Services"
Then it becomes submitted, the draft can no longer be edited, and Sarah sees it under "To approve"

### 2. Parent approves
Given a submitted invoice
When Sarah approves it
Then it is approved, with her name and the time, and becomes available for her own rollup (if she is
a subcontractor) or for the customer invoice (Contractor, level 0)

### 3. Parent rejects with a reason
When Sarah rejects it with reason "Riverside Court total looks high, please check metres"
Then it returns to draft for Hannah with the reason shown; nothing is deleted and the history shows it

### 4. Only the direct parent approves
Given Colm Dunmore or Ravi Patel
When either tries to approve Kessock's invoice
Then it is refused (404); Hannah cannot approve her own (403)
And an Admin who is not also a manager cannot approve or reject (403, default Q17)
And the approver sees the child's total and work summary only; Sarah never sees what Kessock pays
Rowan or its operatives (PD2)

### 5. Issue the company's own invoice
Given Kessock's rollup is complete
When Hannah issues it
Then it is issued with a number, issue date and due date, and carries a snapshot of both companies'
names and addresses (later edits to a company do not change it)

### 6. Cannot issue with unapproved pieces
Given a rollup line that is no longer approved (withdrawn by its issuer)
When Hannah tries to issue
Then it is refused naming the line

### 7. Issued invoices are immutable
Given an issued invoice
When anyone, including any company's Admin, tries to change a line, amount, quantity, date or addressee
Then the API returns 409 `invoice_issued` and nothing changes; there is no edit control

### 8. Correct a mistake with a credit note
Given Kessock issued £1,380.00 by mistake
When Hannah creates a credit note for the whole invoice, with reason "Wrong job"
Then the original is marked void-by-credit, a credit note of -£1,380.00 is linked to it, the work
and child invoices become available to invoice again, and both are visible to the addressee

### 9. Work done on an issued invoice stays locked
Given Aisha's 60 m are on an issued invoice
When anyone tries to change the done quantity or re-assign those 60 m
Then it is refused: "These metres are on issued invoice INV-L1-002"

### 10. Level 0 invoice
Given the Contractor's customer invoice (existing flow)
Then it follows the same issued-is-immutable rule; seeded level 0 invoices keep their current states

## Out of scope
Payment, Stripe links, reminders, PDF rendering and email, partial credit notes (default: full
credit and re-issue), approval by several people, retention.

## Open questions
- Does approval require manager review of the underlying reports first (T-002 D3)? Default: no
  gate in this epic; the approver may see report status as information only.
