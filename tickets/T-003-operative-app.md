# T-003: Operative mobile app (Android first, Expo) (epic)

**Personas:** Operative (field staff; the code and API persona is still `painter`, UI wording is
"Operative", see B9 and T-002l), Manager (sees the result on the existing web app)
**This file is the parent record. The buildable tickets are T-003a to T-003p.**

## Phase change (read this first)
Until now painter capture was out of scope. **This epic starts Phase 2b: the Operative app.**
New in scope: an Expo / React Native app (Android first, for the Play Store; iOS later from the
same code), operative sign-in, assigned jobs, photo capture, offline working, and submitting
completion reports. New write endpoints for the Operative persona are implied (listed below, not
designed here). The manager web app gains only the small changes listed under "Impact on the
web app". Still out of scope: customer payment (Stripe), quotes and deposits, AWS deployment
work (INFRA tickets continue separately), push notifications, iOS release, an operative-side
inbox or chat. **CLAUDE.md "Current phase" still says painter capture is out of scope: the
orchestrator/Paul must update it before T-003a starts** (the product owner does not edit it).

## The operative's journey (what the slices follow)
1. Opens the app at the start of the day, signs in once (T-003b).
2. Sees today's jobs (T-003c), opens one at the customer's address, reads site notes and the
   checklist (T-003d).
3. Takes "before" photos, works, ticks off checklist items with notes and photos (T-003e, f).
4. Photos upload in the background, with or without signal, and the operative always knows what
   has and has not reached the office (T-003g, T-003i).
5. Takes "after" photos, submits the completion report once the required items are done (T-003h),
   safe against double taps, dead batteries and lost signal (T-003j).
6. Optionally records the customer's sign-off or a note (T-003o).
7. The manager reviews it on the web (already built, T-002) and trusts the photos as evidence
   (T-003k).

## Slices, in build order
Each slice is demoable on its own on an Android phone or emulator against the local stack
(`make up`) with seeded data. "Depends on" is the strict dependency; the order is by value.

| Order | Ticket | Slice | Demo | Depends on |
|---|---|---|---|---|
| 1 | [T-003a](T-003a-app-shell-and-build.md) | App shell, build, shared client, branding | Install on a phone, see company name and theme | T-002a |
| 2 | [T-003b](T-003b-operative-sign-in.md) | Operative sign-in, secure session, sign-out | Dan Hughes signs in, restarts the app, is still signed in | T-003a |
| 3 | [T-003c](T-003c-my-jobs-today.md) | My jobs today (API and screen) | Dan sees his 3 jobs for today | T-003b |
| 4 | [T-003d](T-003d-job-detail-and-checklist.md) | Job detail and checklist (read-only) | Open a job, read address, notes, checklist | T-003c |
| 5 | [T-003e](T-003e-capture-photos.md) | Capture photos (camera and gallery), saved on the phone | Take 3 before photos, they survive an app kill | T-003d |
| 6 | [T-003f](T-003f-checklist-progress-notes-item-photos.md) | Tick checklist items, notes, per-item photos (draft report) | Tick 5 items, add a note and a photo to one | T-003e |
| 7 | [T-003g](T-003g-photo-upload-and-sync-status.md) | Photo upload (resumable) and sync status | Photos reach the manager's report detail | T-003f |
| 8 | [T-003h](T-003h-submit-completion-report.md) | Submit the completion report | Submit, then the manager sees it awaiting review | T-003g |
| 9 | [T-003i](T-003i-offline-and-poor-signal.md) | Offline and poor signal working | Airplane mode all day, then sync | T-003g (T-003h for submit-offline) |
| 10 | [T-003j](T-003j-interrupted-submissions-and-duplicates.md) | Interrupted submissions and duplicates (idempotency) | Kill the app mid-submit, no duplicate report | T-003h |
| 11 | [T-003k](T-003k-photo-evidence-integrity.md) | Photo evidence integrity (timestamp, GPS, no editing) | Manager sees taken time and source on each photo | T-003g |
| 12 | [T-003l](T-003l-permissions-and-privacy.md) | Camera and location permissions, privacy | Deny camera, still guided; privacy notice | T-003e |
| 13 | [T-003m](T-003m-accessibility-and-large-text.md) | Accessibility and large text | TalkBack and 200% text pass the main flow | T-003h |
| 14 | [T-003n](T-003n-error-states-and-session-expiry.md) | Error states and session expiry | Token expires mid-day, nothing is lost | T-003g |
| 15 | [T-003o](T-003o-customer-sign-off.md) | Customer sign-off or note (optional, deferrable) | Record "Customer present, happy" at the end | T-003h |
| 16 | [T-003p](T-003p-play-store-readiness.md) | Play Store readiness | Internal test track build installs from Play | all above |

Notes on order:
- **The demo path is online first (a to h), then hardened (i to n).** But "never lose a photo" is
  true from T-003e: a photo is saved on the phone before anything else happens to it.
- T-003k, T-003l, T-003m, T-003n can run in parallel with each other once their dependency exists.
- T-003i is the biggest risk. It should start as soon as T-003g exists, in parallel with T-003h.
- T-003o is the first thing to cut if the pilot is late.

## Decisions (product owner; each also recorded in the ticket it affects)
- **P1. Report states from the operative's side:** `draft` (being worked on, editable by the
  operative) and `submitted` (read-only for the operative). After submission the existing manager
  states take over (`awaiting_review`, `reviewed`). Only a manager can change a submitted report
  (T-002i); the operative cannot reopen it.
- **P2. Required to submit (default):** at least 1 before photo and 1 after photo; every checklist
  item either done or not done with a note saying why; all photos fully uploaded or still safely
  queued with signal to come (see T-003h scenario 4 for the rule).
- **P3. Photo evidence is never edited:** no crop, filter, markup or rotation of the stored
  original. Resizing for upload is allowed and recorded. A photo may be deleted only while the
  report is a draft.
- **P4. Location is optional and never blocks work.** Asked only when the first photo is taken,
  "while using the app" only, never in the background.
- **P5. Gallery photos are allowed** (a photo taken with the phone's own camera app earlier that
  day is common) but are marked "From gallery" for the manager.
- **P6. Photos are kept in app-private storage, not in the phone's gallery** (customers' homes).
- **P7. The operative stays signed in for the working day and beyond** (default 30 days on a
  device, ended at once if the office deactivates the account). The current 30-minute web token
  with no refresh is not acceptable for the field and is implied work for the architect.
- **P8. Android first, Android 10 (API 29) and up**, mid-range phone (3 GB RAM) as the reference
  device. iOS later from the same code; nothing in these tickets may rely on Android-only
  behaviour that would block that.
- **P9. Sign-off is optional and simple** (T-003o): a typed name and an outcome, no drawn
  signature in this epic.

## Non-functional criteria (apply to every slice; tickets cite them as NFR-n)
| # | Criterion | Default |
|---|---|---|
| NFR-1 | Photo size | Stored original is kept as the camera produced it. The upload copy has its long edge at most 2560 px and JPEG quality about 80, typically 0.8 to 2 MB. The server rejects any photo over 10 MB or not JPEG/HEIC/PNG with a clear error. |
| NFR-2 | Photo count | At most 60 photos per report and 12 per checklist item. At the limit the camera button explains why. |
| NFR-3 | Capture speed | From tapping "Take photo" to the camera preview under 2 s on the reference phone; saving a photo to the phone never blocks the next shot. |
| NFR-4 | Upload retry | Failed uploads retry automatically with growing waits (5 s, 15 s, 1 min, 5 min, then every 15 min), plus immediately when signal returns or the operative taps "Sync now". Never gives up on its own and never discards a photo. |
| NFR-5 | Resumable | A 2 MB upload interrupted at 60% resumes from roughly that point (or restarts only that photo), never the whole report, and never creates a second copy. |
| NFR-6 | Battery | No continuous location tracking, no polling faster than once every 5 minutes while the app is in the foreground, no retry storms (NFR-4 limits), retries paused in the phone's battery saver except "Sync now". A full day of use (60 photos) must not use more than about 15% battery attributable to the app (measured, see T-003p). |
| NFR-7 | Mobile data | Upload copy sizing per NFR-1; job lists and details fetched as small JSON; no photo downloaded to the phone except thumbnails of its own photos. "Upload on Wi-Fi only" setting exists, off by default. |
| NFR-8 | Storage | Warn when free storage drops below 500 MB, block new capture below 100 MB with a clear message. Uploaded photos' local copies are removed 7 days after the report is reviewed. |
| NFR-9 | Launch and screens | Cold start to jobs list under 4 s with cached data on the reference phone; every screen usable at 200% font scale (T-003m). |
| NFR-10 | Security | Token in the Android Keystore-backed secure store; no photo or customer data in logs or crash reports; TLS only; no data in the phone gallery or cloud backup. |
| NFR-11 | Wording | UI says "Operative", "job", "completion report"; never "painter" (T-002l). Mock data stays painting and decorating. |

## Implied backend and data changes (for the architect; the product owner does not design them)
The product needs the following to be possible. Shape, names, storage and sequencing are the
architect's decision.
- **Endpoints/capabilities (Operative role only, scoped to the caller's own jobs):**
  list my jobs for a day (plus unfinished earlier jobs); job detail with checklist and the
  customer contact the operative needs on site; create or fetch a draft completion report for a
  job; save checklist item done/note and report notes; upload a photo (resumable, safe to
  repeat) with its metadata and stage and optional checklist item link; delete a photo while the
  report is a draft; submit the report (safe to repeat, with server-side check of the required
  items); read my report's state and which photos the server has; session that lasts the day and
  can be refreshed or ended by the server; server time so the app can detect a wrong phone clock;
  a "minimum supported app version" check; optional sign-off recording.
- **Data:** report draft/submitted state, `submitted_at`/`submitted_by`; client-generated ids for
  report and photos so a repeat is recognised; photo metadata (captured time on device, received
  time on server, source camera or gallery, optional latitude/longitude/accuracy, original
  dimensions, a checksum, upload copy size); photo link to a checklist item; operative note per
  checklist item; sign-off fields; device clock offset at submission. Rename of `painter` to
  operative in the contract (B9) is the architect's call, recorded in the contract version.
- **Authorisation:** an Operative sees and changes only jobs assigned to them; `manager_notes`
  and other managers' data are never returned to the operative; Operative gets 403 on all
  `/manager/*` and `/admin/*` (unchanged).
- **Seed:** each seeded operative needs jobs scheduled for "today" (with the injectable clock),
  one job with a long checklist, one with long notes, one with no checklist, and one already
  submitted.
- **Impact on the web app (small, in T-003k and T-003g):** manager report detail shows, per photo,
  taken time, "From gallery" and "location recorded"; the checklist shows which photos belong to
  an item and the operative's per-item notes; reports show "Submitted by Dan Hughes at ...".
  Existing T-002 editing and review behaviour is unchanged; the manager still cannot edit photos.

## Open product questions (recommended defaults are in effect unless Paul answers)
| # | Question | Recommended default |
|---|---|---|
| Q1 | How long should an operative stay signed in? | 30 days per device, ended immediately on deactivation. |
| Q2 | What if the operative submits and then notices a mistake? | Read-only with "Contact the office to change this report." The manager edits via T-002. No operative "reopen". |
| Q3 | Required items to submit? | 1 before photo, 1 after photo, every checklist item done or explained (P2). Photos per item optional. |
| Q4 | May operatives add photos from the gallery? | Yes, flagged "From gallery" (P5). |
| Q5 | Should photos also be saved to the phone's gallery? | No (P6). Customer homes; avoids personal photo libraries mixing with evidence. |
| Q6 | Is GPS wanted? | Optional per photo if the operative allows it; stored, shown to the manager as "location recorded"; no map and no geofence in this epic. |
| Q7 | Do you want an Admin company setting to require location? | No; later if a customer asks. |
| Q8 | Wi-Fi-only uploads? | Setting exists, off by default (operatives are often on mobile data). |
| Q9 | Is the customer sign-off needed for the pilot? | No; T-003o is deferrable. |
| Q10 | Which jobs show under "today"? | Jobs scheduled today, plus earlier unfinished ones under "Earlier, not finished". Calendar day is Europe/London. |
| Q11 | May operatives see customer phone numbers? | Yes, contact name and phone for assigned jobs only, tap to call. No email address. |
| Q12 | How long are photos kept on the server? | Out of scope; flagged for Paul because customer homes are involved (UK GDPR). Default: kept while the company needs the evidence; a retention policy is decided before launch. |
| Q13 | Shared phones? | Not supported in the pilot: one operative per device. A second operative signing in on the same phone is allowed but never sees the first one's unsent items, and those stay until the first signs in again. |
| Q14 | Biometric unlock and push notifications? | Out of scope; later. |
| Q15 | Minimum Android version and device? | Android 10 and up, 3 GB RAM reference phone (P8). |
| Q16 | Who are the pilot operatives, and is the Play Store listing public? | Default: closed/internal testing track for Arbour Services only, not a public listing, until the pilot ends. |

## Impact on existing tickets and docs
- ARCHITECTURE.md section 15 (Phase 2 starting points) becomes the starting point for the specs;
  section 7 row "Painter capture endpoints" turns from "later" into "own jobs".
- Backlog items **B1 and B2 were labelled "T-003 hardening"** in ARCHITECTURE.md. That number is now
  taken: the architect should relabel them T-004 (hardening).
- T-001b scenario 3 and the demo-account expectations may change if seed jobs for "today" are added.
- The 30-minute no-refresh token (section 8) is the main assumption this epic breaks (P7).

## Out of scope for the epic
Stripe and customer payment, quotes and deposits, push notifications, chat or messaging with the
office, creating jobs or reports without an assigned job, editing job details or customer
details from the app, in-app photo editing or annotation, video, voice notes, drawn signatures,
maps and navigation, time sheets, materials ordering, iOS release, tablet layout, multi-company
switching, AWS deployment work, biometric unlock.
