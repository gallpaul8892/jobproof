# T-004c: "Add a company"

**Persona:** Contractor, Subcontractor (manager)
**Depends on:** T-004b
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q8 (depth), Q14 (who creates)

## Context
A contractor wants to put a subcontractor on a job, and a subcontractor wants to bring in their own.
In the screens there is no word "subcontractor" for this action: it is "Add a company" under the
company you are looking at. Adding is audited (who, when).

## Scenarios

### 1. Contractor adds a company
Given Sarah Whitfield is on Companies for "Arbour Services"
When she clicks "Add a company", enters name "Kessock Decorating Ltd", contact email
"office@kessock.example", phone "0113 496 0142", address "Unit 7, Hunslet Road, Leeds, LS10 1JQ"
and saves
Then "Kessock Decorating Ltd" appears under Arbour Services at level 1
And the audit trail records Sarah, the time and the new company

### 2. Subcontractor adds a company under their own
Given Hannah Kessock is signed in
When she adds "Rowan Finishes" under "Kessock Decorating Ltd"
Then it appears at level 2 under Kessock, and Arbour Services' Contractor also sees it

### 3. Add a company to a company further down
Given Ravi Patel manages "Rowan Finishes"
When he adds "Aldous Decorators" under Rowan Finishes
Then it appears at level 3 and Hannah and Sarah see it in their trees

### 4. Cannot add under someone else's branch
Given Hannah Kessock
When she tries to add a company under "Dunmore Painters"
Then it is refused with 404 and nothing is created

### 5. Duplicate name among siblings
Given Kessock already has "Rowan Finishes"
When Hannah adds another "rowan finishes" under Kessock
Then it shows "A company with this name already exists here" and nothing is saved; the same name
under a different parent is allowed

### 6. Maximum depth
Given the depth limit is 6 levels (root + 5)
When a manager at level 5 tries to add a company
Then it shows "You can't add another level; maximum depth reached" and nothing is saved

### 7. Validation
Given the Add a company form
When name is blank, or email is malformed, or phone is not a UK number
Then each shows a field error and nothing is saved (UK-only rule from T-002p applies)

### 8. Operatives cannot add
Given Dan Hughes (operative)
Then there is no "Add a company" control and the API returns 403

### 9. A company's Admin can add, within their own subtree
Given Hannah Kessock holds the Admin permission for Kessock
When she adds "Rowan Finishes" under Kessock
Then it succeeds; and trying to add under "Dunmore Painters" returns 404 (PD3, Q14)

## Out of scope
Adding people (T-004d), editing or deactivating a company (default: name and contact editable
by the parent chain; deactivation in T-004d), moving a company, VAT or company number fields.

## Open questions
- Should Companies House number or UTR be captured? Default: no (CIS awareness only, Q6).
