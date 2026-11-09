# T-003f: Checklist progress, notes and per-item photos (the draft report)

**Persona:** Operative
**Depends on:** T-003e; needs draft report save (API implied)
**Part of:** [T-003](T-003-operative-app.md) (P1, P2; NFR-2)

## Context
As Dan works he ticks off items ("Ceilings painted, two coats"), adds a note when something
isn't as planned ("Second coat on window wall tomorrow, paint ran out"), and attaches a photo to
the item it proves ("Snagging: scuff on skirting by the door"). Overall notes describe the job
as a whole. This is the draft completion report; it can be left and resumed.

## Scenarios

### 1. Tick an item
Given 9 unticked checklist items
When Dan taps "Walls filled and sanded"
Then it shows as done, the summary reads "1 of 9 done", and it can be unticked again

### 2. Add a note to an item
Given an item
When Dan adds the note "Needs second coat on window wall" (up to 500 characters)
Then it shows under the item and is kept if he leaves the screen and returns

### 3. Item not done, with a reason
Given the item "Spare paint left labelled" is not done
When Dan taps "Can't do this" and enters "Customer already took the tin"
Then the item shows "Not done: Customer already took the tin" and counts as dealt with for submission (P2)
And a "Not done" item with no reason is shown as incomplete

### 4. Attach a photo to an item
Given the item "Sockets and switches masked and refitted"
When Dan taps "Add photo" on that item and takes a photo
Then the photo appears under that item and also in the job's photo groups for its stage,
exactly once, and the item shows "1 photo"

### 5. Attach a gallery photo to an item
Given a gallery photo
When Dan adds it to an item
Then it appears under that item marked "From gallery"

### 6. Move a photo to a different item
Given a photo on item 3 that belongs to item 5
When Dan changes its item before submission
Then it moves, with no duplicate and no re-upload needed

### 7. Overall job notes
Given the report
When Dan types "All rooms done. Customer happy. 2 litres Dulux Chalk White left in the garage."
Then it is saved as the job note (up to 2,000 characters)

### 8. Draft autosaves
Given Dan has ticked 4 items and typed a note
When the app is killed and reopened
Then the 4 ticks and the note are still there, with no "Save" button needed

### 9. Resume on another day
Given the draft was started yesterday
Then it is under "Earlier, not finished" and opens with everything as he left it

### 10. Office changes the checklist
Given the office edits the checklist after Dan started (an item is added or removed)
When Dan refreshes
Then the new list shows, his ticks on remaining items are kept, and any item that was removed
that had a photo or note keeps them under "Other photos and notes" (nothing lost)

### 11. Invalid text
Given a note with 501 characters
Then it is refused with "Keep it to 500 characters." and the text already typed is not lost

### 12. Progress is visible
Given 6 of 9 done
Then the job screen header shows "6 of 9 done" and the My jobs list shows the same (T-003c scenario 4)

## Out of scope
Adding checklist items, changing labels, required photos per item, voice dictation beyond the
phone keyboard's own, rich text, emoji handling beyond what the keyboard sends.

## Open questions
- Is a photo per item required? Default no (P2); only 1 before and 1 after photo are required overall.
