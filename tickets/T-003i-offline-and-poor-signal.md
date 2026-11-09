# T-003i: Works with poor or no signal (offline queue)

**Persona:** Operative
**Depends on:** T-003g (T-003h for submitting offline)
**Part of:** [T-003](T-003-operative-app.md) (NFR-4 to NFR-8). Highest-risk slice: start early.

## Context
Dan works in cellars, new-builds, lofts and rural cottages. Signal comes and goes, sometimes for
a whole day. The app must let him carry on exactly as if online: look at jobs he has opened, tick,
write, take photos, even press Submit, and sync later without him thinking about it. **No photo,
tick, note or submission may ever be lost or silently dropped.** The status must always be honest.

## Scenarios

### 1. Offline banner
Given Dan loses signal
Then within 10 s a banner says "Offline. Your work is saved on this phone and will send when
you're back in signal.", and it disappears when signal returns

### 2. Work offline end to end
Given Dan has opened "Repaint lounge, hall and landing" earlier today and is now offline
When he takes 4 photos, ticks 5 items and adds a note
Then everything saves on the phone, thumbnails show "Waiting", and nothing shows an error

### 3. Back online, it syncs
Given the work in scenario 2
When signal returns
Then all 4 photos, the ticks and the note reach the office in the background without a tap, and
statuses turn to "Sent"; the manager sees them on the web

### 4. Submit while offline
Given a complete draft and no signal
When Dan taps "Submit report" and confirms
Then he sees "Report saved. It will be submitted when you have signal." and the job shows
"Submitted, waiting to send" (distinct from "Submitted")
And on regaining signal photos upload first, then the report is submitted, and the status becomes "Submitted"

### 5. Honest status offline
Given Dan submitted offline
Then he is never told "Submitted" until the server has confirmed it; the manager does not see the
report until it arrives

### 6. A whole day offline
Given no signal from 08:00 to 17:00, 3 jobs, 40 photos
Then all three jobs can be worked and submitted offline, the phone keeps all 40 photos, and at 17:30
with signal everything syncs with no manual step

### 7. Jobs not opened before
Given Dan never opened a job while online and is now offline
Then the job list shows (cached since morning) but opening an unseen job says "This job's details
weren't saved. Connect once to load it." (T-003c loads each job's detail and checklist for today's jobs
in the background when online, so this is rare)

### 8. Poor signal, not none
Given signal flickers every few seconds
Then uploads make progress without freezing the UI, retries follow NFR-4, and the app does not
show a stream of error pop-ups (at most one status line)

### 9. App killed and phone restarted with a queue
Given 10 queued photos and an unsent submission
When the app is force-closed or the phone restarts
Then on reopening the queue is intact, retrying continues, and status counts are the same

### 10. Battery dies
Given Dan took a photo 2 seconds before the phone died
Then after charging and reopening the photo is present (T-003e scenario 4) and queued

### 11. Phone clock wrong
Given the phone clock is 3 days behind
When photos sync
Then they keep the device's taken time but the manager sees "Phone clock was 3 days out" on the
affected photos/report (see T-003k scenario 3); the app also warns Dan "Your phone's date or time
looks wrong. Check your phone settings." when it detects a difference over 5 minutes

### 12. Stale edits
Given Dan edited a checklist note offline and the office changed the same report meanwhile
Then Dan's operative fields (ticks, his notes, photos) are kept; manager-only fields (manager notes)
are never overwritten, and no photo is lost; if a true conflict remains he sees "The office changed
this report. Review" with both versions (rule: the operative's evidence is never discarded)

### 13. Retry behaviour
Given the server is returning errors
Then retries follow 5 s, 15 s, 1 min, 5 min, then every 15 min (NFR-4), and stop retrying a request
that can never succeed (for example "report already submitted") with a clear status instead of looping

### 14. Battery saver
Given the phone's battery saver is on
Then automatic retries pause and the sync line says "Paused by battery saver. Tap Sync now."; "Sync now" still works (NFR-6)

### 15. Cache housekeeping
Given a report is reviewed and 7 days have passed and all photos are sent
Then its local photos and cached data are removed; unsent items are never removed

### 16. Storage fills up offline
Given storage falls under 100 MB offline
Then capture is refused with the T-003e message, existing queued photos are kept

## Out of scope
Peer-to-peer sync, Bluetooth transfer, making unseen jobs available offline in advance for the
whole week, merging concurrent manager edits automatically beyond scenario 12, sync of other
operatives' data.

## Open questions
- How many days of future jobs should be pre-loaded? Default: today and unfinished earlier jobs only.
- Offline sign-in is not supported; an expired session with no signal keeps the app usable (T-003n).
