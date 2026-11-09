# T-003j: Interrupted submissions and duplicates (idempotency)

**Persona:** Operative; Manager (must not see duplicates)
**Depends on:** T-003h
**Part of:** [T-003](T-003-operative-app.md)

## Context
Dan taps Submit, the signal drops, and he does not know whether it went through. He taps again,
or the app retries by itself. The office must end up with exactly one report and exactly one
copy of each photo, and Dan must be told the truth. The product requirement is "repeating is
always safe"; how the server recognises a repeat is the architect's decision.

## Scenarios

### 1. Double tap on Submit
Given a complete draft
When Dan taps "Submit report" and confirm twice within a second
Then exactly one report is submitted, he sees one "Report submitted", and the manager's web list
shows one report for the job

### 2. Submit succeeded but the reply was lost
Given the server received the submission but the phone never got the answer
When the app retries
Then the result is the same single submitted report (not an error, not a second report) and
Dan sees "Report submitted"

### 3. Killed in the middle of submit
Given the app is force-closed after sending "submit" and before showing the result
When Dan reopens it
Then the job shows the true state (the app checks with the server): "Submitted" if it arrived, or
"Submitted, waiting to send" and it completes itself; never "draft" with a lost submission, and no duplicate

### 4. Photo sent twice
Given a photo was received by the server but the app did not hear back, and retries
Then the report has one copy of that photo and the app marks it "Sent"

### 5. Same photo added twice by the operative
Given Dan picks the same gallery photo for a job twice
Then he is told "This photo is already on this job." and it is added only once, but the same photo
on two different jobs is allowed

### 6. Two phones, same operative
Given Dan is signed in on his phone and an old phone and both have the same draft
When both submit
Then exactly one submission is accepted, the other shows "This report was already submitted from another device" and its photos are
kept, never deleted, and no data is lost on either

### 7. Submit after the manager edited
Given the office reviewed or edited the report (rare) before Dan's offline submit arrives
Then Dan's submission does not overwrite manager edits or reviewer fields; the outcome shown to Dan is
"Already submitted" and the manager's state is unchanged

### 8. Duplicate protection survives reinstall
Given Dan reinstalls the app and signs in
Then his submitted reports and photos show from the server as "Submitted"/"Sent" and he can't create a
second report for the same job

### 9. No duplicate when retry races with "Sync now"
Given an automatic retry and a manual "Sync now" fire at the same time
Then the outcome is one photo, one report

### 10. Audit visible to the manager
Given an operative retried a submission
Then the manager sees one report with one "Submitted at" time (the first accepted), not one per attempt

## Out of scope
Merging two different drafts into one, detecting visually similar photos, undoing a submission.

## Open questions
- If two devices hold different drafts, which wins? Default: first to submit wins. Offering "Add to
  the submitted report?" on the other device is not built now: its extra photos stay on that phone
  with status "Not sent: report already submitted" and the office is not told. Paul to confirm this
  is acceptable for the pilot (one device per operative, Q13, makes it rare).
