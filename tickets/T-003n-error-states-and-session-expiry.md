# T-003n: Error states and session expiry

**Persona:** Operative
**Depends on:** T-003g
**Part of:** [T-003](T-003-operative-app.md) (P7, Q1, NFR-4)

## Context
Things go wrong in the field: the server is down, the app is out of date, a job vanishes, the
session ends. Dan needs plain-English messages that tell him what to do, and above all must never
lose work because of an error. Today the web token lasts 30 minutes with no refresh; for the app a
working day must be safe (decision P7, mechanism is the architect's).

## Scenarios

### 1. Session expires while working online
Given Dan's session has expired and he has 5 unsent photos
When the app next contacts the server
Then he sees "Please sign in again to finish sending." with the sign-in screen (email kept), and the
5 photos, ticks and notes stay on the phone

### 2. Sign in again, resume
Given the scenario above
When Dan signs in as himself
Then he returns to where he was, and the 5 photos send without him re-taking anything

### 3. Session expires while offline
Given the session expired and there is no signal
Then the app keeps working fully (T-003i) and prompts for sign-in only when signal returns and it needs to send

### 4. Different person signs in after expiry
Given Dan's session expired and Priya Shah signs in on the phone
Then Dan's queue stays untouched and unreadable to Priya (T-003b scenario 10) and is not sent under Priya

### 5. Server unavailable
Given the server returns errors (500, 503) for 10 minutes
Then Dan sees "The office system is having problems. Your work is saved and will send later.", and the
retry rules in NFR-4 apply, with no data lost and no alarming pop-up per failed request

### 6. App too old
Given the server says the app version is no longer supported
When Dan opens the app
Then he sees "Please update the app to continue." with a button to the Play Store, but any queued photos
and drafts are kept, and a still-supported older version shows no message

### 7. A job vanishes while I have unsent work
Given the office cancels or reassigns a job, and Dan has unsent photos for it
Then those photos stay on the phone under "Needs attention" with "This job was changed by the office.
Contact the office." and are never auto-deleted; Dan can ask the office and Sync now

### 8. Job already closed by the office
Given a manager has already completed the job
When Dan's queued submit arrives
Then he sees "The office has already closed this job." (T-003h scenario 8) and his photos are kept

### 9. Photo permanently refused
Given the server refuses a photo (too large, wrong type) for good
Then it is marked "Couldn't be sent" with the reason, kept on the phone, and Dan can delete it or leave it;
other photos continue

### 10. Rate limiting
Given the server says "too many requests, try later"
Then retries back off further and Dan sees "Busy. Trying again shortly."

### 11. Unexpected crash
Given the app crashes
Then on reopening everything saved is intact, and Dan is told "The app closed unexpectedly. Your work is saved."
(crash reports contain no photos or customer data: T-003l scenario 10)

### 12. Clear next step on every error
Given any error message
Then it says what happened in plain words and what to do (Retry, Sign in, Contact the office), never a
status code or technical text

### 13. Deactivated account
Given the office deactivated Dan
Then T-003b scenario 11 applies, and his queue is kept on the phone

## Out of scope
A support chat, error reporting UI for the operative, remote wipe, force-clearing a user's data.

## Open questions
- Remote wipe of a lost phone: later; the session ending server-side is the control for now.
- How strict for app updates? Default: only a hard minimum version is enforced; no nagging for optional updates.
