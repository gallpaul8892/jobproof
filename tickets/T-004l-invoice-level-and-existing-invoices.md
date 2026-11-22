# T-004l: Every invoice records its level; existing invoices become level 0

**Persona:** Contractor (Manager today), Admin (of a company)
**Depends on:** T-004a
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q11, PD2. Also touches T-001b/T-001c invoices.

## Context
An invoice must record what level of the hierarchy it is at. Level 0 is the invoice the Contractor
sends the customer, which is what the product has today. This ticket introduces the level and
the issuer/addressee on existing invoices, with no change in what the manager sees except a new
"Level" column.

## Scenarios

### 1. Existing invoices are level 0
Given the 52 seeded invoices (customer invoices)
When the migration runs
Then each has level 0, issuer "Arbour Services", and its customer as the addressee; amounts,
statuses, dates and the derived overdue/paid statuses are unchanged

### 2. Billing page shows the level
Given Sarah opens Billing
Then the list has a "Level" column showing "0" and can be filtered by level; the totals and counts
she saw before (52 invoices) are unchanged

### 3. Invoice detail shows issuer and addressee
Given she opens invoice INV-0007
Then it shows "From Arbour Services, level 0" and "To Harbourside Lettings Ltd" (customer)

### 4. Level is derived, not typed
Given any invoice
Then its level equals the level of its issuing company (operative invoices: company level + 1)
And the API refuses a request that sets a level directly (422)

### 5. Level 0 is addressed to a customer; others to the parent
Given an invoice at level 1 or deeper
Then its addressee is the issuer's parent company, and creating one with a customer addressee is refused

### 6. Only the issuer and the addressee see it (money scope)
Given a level 1 invoice from Kessock to Arbour
Then Hannah (issuer) and Sarah (addressee) can read it, as can each company's Admin read only
(T-004p); Colm Dunmore and Ravi Patel get 404
And a level 2 invoice from Rowan Finishes to Kessock is not readable by Sarah or Tom Ashworth (404),
because Arbour Services is not its addressee (PD2)

### 7. Contract tests
Given the OpenAPI document
Then every invoice schema has `level`, issuer and addressee, money fields are integer pence, and
generated clients compile

## Out of scope
Creating level 1 or deeper invoices (T-004m, T-004n), PDFs, VAT.

## Open questions
- Operative invoices are "company level + 1": is the numbering natural to Paul? Default: yes;
  displayed as "Level 3 (operative)".
