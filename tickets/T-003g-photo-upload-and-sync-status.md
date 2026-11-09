# T-003g: Photo upload (resumable) and sync status

**Persona:** Operative; Manager (sees the photos arrive)
**Depends on:** T-003f; needs a photo upload capability and draft report save (API implied)
**Part of:** [T-003](T-003-operative-app.md) (NFR-1, 4, 5, 7)

## Context
Photos must reach the office, and Dan must always know whether they have. Uploads happen in the
background while he carries on working, over whatever signal he has. A photo is never removed
from the phone until the server confirms it has it. This ticket covers uploading with signal;
the no-signal behaviour is T-003i, and the repeat-safe rules are T-003j.

## Scenarios

### 1. Photos upload in the background
Given Dan has taken 3 photos with good signal
Then within about 30 s each shows "Sent" (a tick), without him doing anything, and he can keep working

### 2. Status of every photo
Given photos in different situations
Then each thumbnail shows exactly one of: "Waiting" (clock), "Sending 40%" (progress), "Sent" (tick),
"Will retry" (warning with the reason, for example "No signal"), never a blank state

### 3. Job and report level summary
Given 12 photos: 9 sent, 2 sending, 1 waiting
Then the job screen shows "9 of 12 photos sent" with a progress bar, and the My jobs list shows
a small "Photos sending" marker on that job

### 4. App-wide sync status
Given any screen
Then a status line in the header shows one of "All sent", "Sending 3 photos", "Waiting for signal (3 photos)",
or "Needs attention (1)", tappable to a "Sync" screen listing every unsent item by job

### 5. Sync now
Given 3 photos are "Will retry"
When Dan taps "Sync now"
Then uploads are attempted immediately, ignoring the retry wait and the phone's battery-saver pause (NFR-6)

### 6. Upload copy size
Given a camera photo of 4000 x 3000 px and 6 MB
When it is uploaded
Then the copy sent is at most 2560 px on its long edge and typically 0.8 to 2 MB (NFR-1), and the
full-size original stays on the phone until the report is reviewed plus 7 days (NFR-8)
And the server records both the original and the upload dimensions

### 7. Manager sees the photos
Given Dan's 3 photos are sent
When Sarah Whitfield opens the job's report on the web
Then she sees the 3 photos under Before with their taken times and Dan's captions, and the report
shows the job's checklist ticks and notes as of the last sync

### 8. Interrupted upload resumes
Given a 2 MB photo is 60% sent and the signal drops
When signal returns
Then the upload resumes (NFR-5) and the report has exactly one copy of the photo

### 9. Server rejects a photo
Given a file the server refuses (over 10 MB, not an image)
Then the photo shows "Couldn't be sent: file too large/not a photo" and stays on the phone,
Dan is told which photo, and the other photos continue uploading (no stuck queue)

### 10. Wi-Fi only setting
Given "Upload on Wi-Fi only" is on and the phone is on mobile data
Then photos show "Waiting for Wi-Fi" and are not sent, and "Sync now" asks "Use mobile data this time?" (NFR-7)

### 11. Upload order
Given photos waiting
Then they send oldest first, one or two at a time (not all at once), so a poor signal finishes
photos rather than stalling every one at 50% (NFR-4, NFR-5)

### 12. Photo deleted while queued
Given a photo is waiting to send
When Dan deletes it
Then it is never sent, and if it had partly sent, no trace of it remains on the report

### 13. Operative changes stage or item after upload
Given a photo already "Sent" as Before
When Dan changes it to During
Then the report on the web shows it under During after the next sync, still one photo

## Out of scope
Background uploads while the app is closed beyond what the platform allows (the app must at least
continue when backgrounded briefly and resume on next open; fuller background work is for the
architect to propose), photo compression settings screen, downloading other photos to the phone.

## Open questions
- Should uploads continue when the app is not in the foreground? Default: yes where Android
  allows, otherwise resume on the next open with a visible "Open the app to finish sending" notice.
