# T-004d: Add and deactivate people in a company

**Persona:** Contractor, Subcontractor (manager)
**Depends on:** T-004c
**Part of:** [T-004](T-004-company-hierarchy-and-tiered-invoicing.md); Q7, Q12, Q14. Pulls forward
part of backlog B13 (no user management).

## Context
A company is only useful with people. After "Add a company" the manager adds the company's
managers and operatives. There is no email invitation (out of scope), so the manager sets a
temporary password the person must change. Without this, no subcontractor can ever sign in.

## Scenarios

### 1. Add an operative
Given Hannah Kessock is on "Kessock Decorating Ltd"
When she chooses "Add a person", enters name "Aisha Rahman", email "aisha@kessock.example", role
Operative, "Invoices: yes", and a temporary password
Then Aisha is listed under Kessock as an Operative; the audit trail records Hannah and the time

### 2. First sign-in forces a password change
Given the temporary password was set
When Aisha signs in for the first time
Then she must set a new password (at least 12 characters) before she reaches anything else
And the temporary password stops working

### 3. Add a manager
Given Hannah adds "Ravi Patel", role Manager, to "Rowan Finishes"
Then Ravi signs in to the web app and sees Rowan Finishes and below only

### 4. Email already used
Given "aisha@kessock.example" exists
When anyone adds a person with that email, in any company
Then it is refused with "This email is already registered" (an email belongs to one person, Q7)

### 5. Not in someone else's branch
Given Hannah Kessock
When she tries to add a person to "Dunmore Painters"
Then it is refused with 404

### 6. Deactivate a person
Given Aisha has submitted 3 reports
When Hannah deactivates her
Then Aisha cannot sign in and her mobile session ends at once (T-003 P7)
And her reports, allocations and history remain, shown as "Aisha Rahman (deactivated)"

### 7. Deactivating someone with unfinished allocations
Given Aisha has an allocation of 100 m with 40 m done
When Hannah deactivates her
Then it asks "Aisha has 60 m not finished. Re-assign it now?" and deactivation proceeds only after
the remainder is re-assigned or withdrawn (T-004g), or Hannah confirms leaving it unassigned

### 7a. Add an Admin
Given Hannah Kessock adds Ravi Patel to "Rowan Finishes" with the Admin permission (alone or with Manager, Q16)
Then Ravi, as Admin, sees progress for Rowan Finishes and below (T-004j) and invoices as T-004p allows
And an Admin without the Manager permission still cannot open report photos or text
And only the root company's Admin sees Settings (name, colours)

### 8. A company needs a manager
Given "Rowan Finishes" has one manager
When anyone tries to deactivate that manager and the company has active operatives or allocations
Then it is refused with "A company needs at least one manager" unless another manager is added first

### 9. Deactivate a company
Given "Dunmore Painters" has no unfinished allocations or unpaid invoices
When Sarah deactivates it
Then it and its people can no longer sign in, and it stays in history; with unfinished work it is refused

## Out of scope
Email invitations, forgotten password, self-registration, moving a person between companies,
employment details, qualifications, CSCS cards.

## Open questions
- Can a manager also be an operative (one account, both permissions)? Default: yes (Q7).
