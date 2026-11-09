# T-003d: Job detail and checklist (read-only)

**Persona:** Operative
**Depends on:** T-003c
**Part of:** [T-003](T-003-operative-app.md) (Q11)

## Context
Arriving at a site, Dan needs the address, how to get in ("Key safe by the front door"), who to
ring, what the job is, and the list of work he is expected to complete. Nothing here is editable
yet; ticking items is T-003f.

## Scenarios

### 1. Job detail content
Given Dan opens "Repaint lounge, hall and landing"
Then he sees reference, job type "Interior repaint", the site address (BS6 5QA), the office/site
notes (including "Key safe by the front door; code sent by text") and the scheduled date

### 2. Customer contact for this job only
Given the customer is Mrs A. Patel, 07700 900555
Then he sees the contact name and phone, and tapping the number opens the phone's dialler with
the number filled in (not dialled)
And no customer email address or billing details are shown

### 3. Address opens maps
Given the site address
When Dan taps it
Then the phone offers to open it in a maps app; the app itself has no map

### 4. Checklist shown
Given the job's checklist has 9 items, such as "Walls filled and sanded" and "Ceilings painted, two coats"
Then all 9 are listed in order, each unticked, with a "0 of 9 done" summary

### 5. Job with no checklist
Given a job with no checklist items
Then he sees "No checklist for this job. You can still take photos and submit." and the rest works

### 6. Long notes
Given site notes of 1,500 characters
Then they show collapsed with "Show more", and expanded they scroll without breaking layout

### 7. Not my job
Given a job id that belongs to Priya Shah
When Dan's app requests it (for example from an old notification or deep link)
Then he sees "This job isn't available." and returns to the list

### 8. Job changed by the office
Given the office edits the notes after Dan loaded the job
When Dan pulls to refresh the job
Then the new notes show; an in-progress draft's ticks are untouched

### 9. Offline
Given the job was opened before and there is now no signal
Then the detail and checklist still show from the phone, with "Offline" shown, never an empty screen
And every job on today's list (and the earlier unfinished ones) has its detail and checklist saved
on the phone automatically whenever the list loads with signal, so offline opening works for all of
them, not only jobs already opened (T-003i scenario 7)

### 10. Submitted job is read-only
Given the report for this job was submitted
Then the detail opens with "Submitted 14:12" and no way to start capture (see T-003h)

## Out of scope
Editing job details or the checklist's labels, adding checklist items, quotes or prices shown to the
operative (they never see money), customer history.

## Open questions
- Should operatives see the job price or quote? Default: no, never.
