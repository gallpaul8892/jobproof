# T-003k: Photo evidence integrity (timestamp, optional GPS, no editing)

**Persona:** Manager (relies on it); Operative (is protected by it)
**Depends on:** T-003g (web changes touch the existing report detail)
**Part of:** [T-003](T-003-operative-app.md) (P3, P4, P5, Q6)

## Context
Managers bill customers on the strength of these photos, and a customer may dispute a job. The
manager needs to know when each photo was taken, whether it came from the camera or the gallery,
and whether it is untouched. The operative is helped by the same facts ("I was there at 14:10").
This ticket makes the evidence trustworthy and visible. It does not make it tamper-proof against
a determined fraudster (a phone's clock can be changed; that is flagged, not prevented).

## Scenarios

### 1. Taken time recorded
Given Dan takes a photo at 08:14 on 15 Oct 2026
Then the report records 08:14 (local time shown, UTC stored) as the taken time, plus the time the
server received it, and Sarah sees both on the web photo (for example "Taken 08:14, received 08:15")

### 2. Gallery photos keep their original time
Given Dan adds a gallery photo whose file says taken 14 Oct 2026 17:50
Then the report shows "From gallery, taken 14 Oct 17:50" (not the time he added it), and a photo with
no readable time shows "Taken time unknown, added 15 Oct 08:20"

### 3. Phone clock mismatch flagged
Given the phone's clock was 3 days behind when the photo was taken
Then the manager sees "Phone clock was out by about 3 days" on that photo, and Dan's own screen
shows the same warning (T-003i scenario 11)

### 4. Photo not taken on the job day
Given a "Before" photo taken 5 days before the job's scheduled date
Then the manager sees a "Taken on a different day" note on it (information only, never blocks submission)

### 5. Location, with permission
Given Dan allowed location when first asked (T-003l)
When he takes a photo
Then the latitude, longitude and accuracy are recorded with it, and the manager sees "Location
recorded" (no map in this epic); with no GPS fix within 5 s the photo is saved without a location and
not delayed

### 6. Location, without permission
Given Dan chose "Not now" or denied location
Then photos are saved with no location, nothing blocks him, and the manager sees "No location"

### 7. Location is not captured from the gallery by guess
Given a gallery photo
Then any location in the file is recorded as "from file", never as the phone's current location

### 8. No editing
Given any photo, in the app or after submission
Then there is no crop, rotate, filter, markup or replace; the only changes are stage, item link and
caption (before submission), and deletion (draft only, T-003e scenario 9)

### 9. Original kept and checkable
Given an uploaded photo
Then the server stores the file received and a fingerprint of the original, and a test can show a
re-upload of an altered file with the same photo id is refused, not replaced

### 10. Operative metadata visible to the manager
Given the manager's report detail
Then it shows, for each photo: stage, taken time, "From camera" or "From gallery", "Location recorded"
or "No location", and which checklist item it belongs to; the manager still cannot edit photos

### 11. Deletion before submission is visible
Given Dan deleted a photo from a draft
Then it never reaches the report and nothing is shown to the manager; after submission no deletion is possible

### 12. Metadata privacy
Given photos are shown to the manager
Then the exact GPS coordinates are visible only to managers (never in a link a customer could open),
and the device model and other EXIF fields are not stored beyond those listed

## Out of scope
Maps and geofencing ("was he at the site?"), cryptographic signing or watermarking, blockchain,
facial blurring, automatic detection of re-used or screen photos, customer-facing evidence links.

## Open questions
- Show a map pin to managers? Default: not in this epic.
- Strictness on gallery photos: default flagged, not blocked (Q4).
