# T-003h: Submit the completion report

**Persona:** Operative; Manager (receives it)
**Depends on:** T-003g; needs a submit capability (API implied)
**Part of:** [T-003](T-003-operative-app.md) (P1, P2, Q2, Q3)

## Context
Submitting is the moment Dan tells the office "this job is done, here is the proof". It starts
the manager's review and, later, the bill. It must be deliberate (confirmation), must refuse an
incomplete report with clear reasons, and once submitted the report belongs to the office: Dan
cannot change it. Only a manager can (T-002i).

## Scenarios

### 1. Submit a complete report
Given a draft with 2 Before photos, 3 After photos, all 9 checklist items done, all photos sent
When Dan taps "Submit report" and confirms "Submit this report? You can't change it afterwards."
Then he sees "Report submitted" with the time, the job shows "Submitted" in My jobs
And in the manager web app the report appears as awaiting review, "Submitted by Dan Hughes at 14:12",
with its photos, ticks and notes, and the dashboard awaiting-review count goes up by 1

### 2. Missing before or after photo
Given no After photos
When Dan taps "Submit report"
Then the report is not sent and he sees "Add at least 1 After photo." with a button "Take After photo"
(and the same for Before)

### 3. Checklist items not dealt with
Given 2 of 9 items are neither done nor marked "Can't do this" with a reason
When he taps "Submit report"
Then he sees "2 checklist items need ticking or a reason:" with the item names, each tappable

### 4. Photos still on the phone
Given 2 photos are not yet sent (poor signal)
When Dan taps "Submit report"
Then he is told "2 photos are still sending. Submit once they're sent, or submit now and they will
follow." with both choices, and:
- "Wait" returns to the job
- "Submit now" accepts the report, shows "Submitted. 2 photos still sending" and never loses the
  photos; the manager sees "2 photos still to arrive" until they do (full offline behaviour: T-003i)

### 5. Cancel at the confirmation
Given the confirmation is showing
When Dan taps "Cancel"
Then nothing is sent and the draft is unchanged

### 6. Submitted report is read-only
Given a submitted report
Then Dan can view photos, ticks and notes but sees no tick boxes, no add photo, no delete, no
"Submit", and the message "Contact the office to change this report." (Q2)

### 7. Server refuses a submission
Given the server rejects submit (for example "job was cancelled by the office")
Then Dan sees the reason in plain words, the draft stays unsubmitted and unchanged, and nothing is lost

### 8. Job already completed by the office
Given the manager had already marked the job complete
When Dan submits
Then he sees "The office has already closed this job." with the draft kept for reference, and
no second report is created

### 9. Summary before submit
Given the confirmation
Then it first shows a summary: "2 Before, 3 After, 1 During photos; 9 of 9 checklist items;
notes added; customer sign-off: none" so Dan can check at a glance

### 10. Report shows who and when
Given a submitted report
Then Dan's own view shows "Submitted 14:12 today by Dan Hughes", and a later manager edit or
review shows as "Reviewed by Sarah Whitfield" (read-only, no detail of the manager's notes:
`manager_notes` are never shown to the operative)

### 11. Submitting empties the "needs doing" list
Given Dan submits the last job of the day
Then My jobs shows all 3 as Submitted and the app status reads "All sent" once photos have sent

## Out of scope
Operative reopening or amending a submitted report, partial or staged submission, emailing the report,
billing triggered by submission, a manager sending a report back to the operative for rework
(possible later; today the manager edits it).

## Open questions
- Should the operative be able to submit with a photo still queued (scenario 4)? Default yes,
  with the warning; the office sees what is outstanding. Alternative: block. Paul to confirm.
- Is "after" mandatory for jobs with no visible output (e.g. a quote visit)? Default yes for this
  pilot; a per-job-type rule is later.
