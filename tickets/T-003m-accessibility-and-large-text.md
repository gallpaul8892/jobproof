# T-003m: Accessibility and large text

**Persona:** Operative (including those with low vision, dyslexia, or using gloves, ladders and bright sun)
**Depends on:** T-003h (the main flow exists); applies to every later screen
**Part of:** [T-003](T-003-operative-app.md) (NFR-9, NFR-11)

## Context
Operatives are of all ages, work outdoors in glare, wear gloves, hold a brush in the other hand,
and many set their phone to larger text. The app must be usable at the largest text setting and
with TalkBack, with big touch targets for the actions that matter most. Reuse the contrast rule
already enforced for the company theme.

## Scenarios

### 1. Large text at 200%
Given the phone's font size and display size are at the largest setting (about 200%)
When Dan goes through sign-in, My jobs, a job, take photo, tick an item, and submit
Then no text is cut off or overlapping, every button label is fully visible (wrapping, not truncating),
and the flow is completable

### 2. Touch targets
Given every tappable control
Then it is at least 48 x 48 dp, and the primary actions (Take photo, Submit report, Sync now, shutter,
tick box rows) are at least 56 dp tall with spacing so a gloved thumb doesn't hit the neighbour

### 3. Screen reader
Given TalkBack is on
When Dan moves through My jobs
Then each job reads as "Repaint lounge, hall and landing, BS6 5QA, in progress, 6 of 9 done, button",
and the focus order follows the visual order

### 4. Photos and status have text alternatives
Given a photo thumbnail
Then TalkBack reads "Before photo, taken 08:14, sent" (and caption if any), and the sync status line
is announced when it changes ("3 photos sent")

### 5. Checklist items
Given a checklist row
Then it is announced as "Walls filled and sanded, checkbox, not checked", and toggling announces the new state

### 6. Not colour alone
Given statuses (Sent, Waiting, Will retry, Not done, Needs attention)
Then each has an icon and a word as well as a colour

### 7. Contrast, including company theme
Given any company colour scheme the Admin has set
Then text and controls reach 4.5:1 contrast (the existing rule), and in a high-brightness setting the
app remains legible (verified with the default theme in direct light on a reference phone)

### 8. Camera screen
Given the camera screen
Then the shutter button is large, reachable with one hand, labelled "Take photo" for TalkBack, and the
volume key also takes the photo (so a gloved or one-handed operative can shoot)

### 9. Dark mode and display size
Given the phone is in dark mode or has a larger display size
Then the app stays legible with no invisible text or icons

### 10. Errors are readable and announced
Given a validation or sync error
Then it appears next to the field or control in words, is announced to TalkBack, and never relies on a
vanishing toast alone

### 11. Reduced motion
Given the phone's "remove animations" setting
Then no non-essential animation plays

### 12. Automated and manual checks
Given the release build
Then an accessibility scan (Android Accessibility Scanner) finds no missing labels or small targets on the
main flow, and a manual TalkBack pass of the main flow is recorded in the ticket's test notes

## Out of scope
Voice control tuning, switch access, languages other than British English, right-to-left layouts,
iOS VoiceOver testing (later with iOS).

## Open questions
- Volume key as shutter: default yes (scenario 8).
