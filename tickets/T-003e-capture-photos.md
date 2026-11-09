# T-003e: Capture photos (camera and gallery), saved on the phone

**Persona:** Operative
**Depends on:** T-003d
**Part of:** [T-003](T-003-operative-app.md) (P3, P5, P6; NFR-1, 2, 3, 8)

## Context
The photos are the evidence the office bills from. Dan takes before, during and after photos with
the camera, sometimes with one hand and a brush in the other, standing on a ladder or in a dusty
room. The first rule of the product: **once he has pressed the shutter, that photo is safe on the
phone**, whatever happens next (no signal, app killed, battery dies). This ticket stores photos
locally; sending them is T-003g.

## Scenarios

### 1. Take a before photo
Given Dan is on "Repaint lounge, hall and landing" with a draft not yet started
When he taps "Take photo", chooses stage "Before", and presses the shutter
Then the photo appears in the job's "Before" group with a thumbnail and the time it was taken
(for example 08:14), and the job becomes "In progress"

### 2. Stages
Given the capture screen
Then the stage is one of Before, During, After, shown as three large buttons (not a small
dropdown), the last used stage is preselected, and the stage can be changed on a taken photo
until it is submitted

### 3. Take several in a row
Given Dan takes 5 photos in 30 seconds
Then the camera is ready for the next shot straight after each (NFR-3), a counter shows 5 photos,
and none is lost or duplicated

### 4. Photo survives an app kill
Given Dan has taken 3 photos
When the app is force-closed (or the phone restarts) immediately after the third shutter press
Then on reopening all 3 are in the job, and the third is not corrupt or missing

### 5. Pick from the gallery
Given Dan took a photo earlier with the phone's camera app
When he taps "Choose from gallery" and picks it and stage "During"
Then it is added to the job marked "From gallery", keeping the time it was originally taken

### 6. Pick several at once
Given Dan selects 4 photos in the gallery picker
Then all 4 are added with the same stage, and a summary says "4 photos added"

### 7. Caption (optional)
Given a photo
When Dan adds the caption "Damp patch above window" (up to 140 characters)
Then it shows under the thumbnail, a longer caption is refused with "Keep it to 140 characters.",
and a caption is never required

### 8. View a photo
Given a thumbnail
When Dan taps it
Then he sees it full screen with its stage, time and caption, and can pinch to zoom
And there are no crop, rotate, filter or draw tools anywhere (P3)

### 9. Delete before submission
Given a photo in a draft
When Dan taps "Delete photo" and confirms "Delete this photo? This can't be undone."
Then it is removed from the phone and, if already uploaded, from the report; the counter drops by one

### 10. Limits
Given 60 photos are already in the report (or 12 on one checklist item)
When Dan tries to add another
Then he sees "This report has the maximum 60 photos." (or "This item has the maximum 12 photos.")
and nothing is added (NFR-2)

### 11. Storage low
Given free storage under 500 MB
Then a banner says "Phone storage is low." and capture works; under 100 MB capture is refused with
"Not enough space to save photos. Free up space on your phone." (NFR-8)

### 12. Corrupt or unreadable gallery file
Given a gallery item that is not a readable image (a screenshot saved as a video, or a deleted file)
Then it is skipped with "1 file couldn't be added" and the others are added

### 13. Not in the phone's gallery
Given Dan takes a photo in the app
Then it does not appear in the phone's Photos or Gallery app (P6)

### 14. Photos and the report stay together
Given photos taken for job A
Then they never appear under job B, even when Dan switches jobs mid-capture

## Out of scope
Video, burst mode, flash and zoom controls beyond the camera defaults, scanning documents, in-app
editing or annotation (never), automatic stage detection, reordering photos.

## Open questions
- Should the photo be saved at full camera resolution on the phone? Default yes, with the smaller
  upload copy made for sending (NFR-1).
- Camera orientation: default is stored as the camera produced it, with orientation recorded, not rewritten.
