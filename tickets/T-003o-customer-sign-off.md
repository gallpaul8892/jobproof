# T-003o: Customer sign-off or note (optional, deferrable)

**Persona:** Operative; Manager; Customer (indirectly)
**Depends on:** T-003h
**Part of:** [T-003](T-003-operative-app.md) (P9, Q9). **First slice to cut if the pilot is late.**

## Context
When a job ends the customer is often at home. A simple record of "the customer was there and
was happy" (or was not, or was out) helps the office when a bill is questioned. It is not a
legal signature and not a payment step. Keep it to a typed name and an outcome so it works on a
small screen with no signal.

## Scenarios

### 1. Customer present and happy
Given a draft ready to submit
When Dan taps "Customer sign-off", picks "Customer present, happy with the work" and types the name "A. Patel"
Then the sign-off shows on the job with the time, and the manager sees "Customer present, happy:
A. Patel, 14:05" on the report

### 2. Customer present, not happy
Given the same screen
When Dan picks "Customer present, has concerns" and types a note "Wants the hall ceiling redone, streaky"
Then it is saved, the manager sees it highlighted on the report, and submission is still allowed

### 3. Customer not present
Given nobody is home
When Dan picks "Customer not present"
Then it is recorded with the time, and no name is required

### 4. Name rules
Given "Customer present" is chosen and the name is empty
Then he sees "Enter the customer's name." and for "Not present" the name field is hidden

### 5. Optional
Given no sign-off has been recorded
Then the report can still be submitted, and the submit summary shows "Customer sign-off: none" (T-003h scenario 9)

### 6. Works offline and survives restarts
Given no signal
Then a sign-off saves on the phone and sends with the report, and is never lost (T-003i)

### 7. Read-only once submitted
Given a submitted report
Then the sign-off cannot be changed by the operative; a manager sees it with the report

### 8. Not a signature
Given the sign-off screen
Then it carries the line "This records what the customer told you. It is not a signature." and no
drawing pad appears (P9)

### 9. Privacy
Given the sign-off is shown to the manager only
Then it is never sent to the customer by the app and is not part of any link the customer opens

## Out of scope
Drawn signature, customer receiving a copy by email or text, customer rating, payment taken
on site, handing the phone to the customer to complete (a legal-signature product question).

## Open questions
- Is a drawn signature wanted later? Default: not in this epic.
- Should "has concerns" alert the manager? Default: shown on the report only; no notification (no push in this epic).
