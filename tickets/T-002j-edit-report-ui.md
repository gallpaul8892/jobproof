# T-002j: Edit a report in the web app (with conflict handling)

**Persona:** Manager
**Owner:** frontend-engineer (test-engineer for e2e)
**Depends on:** T-002i, T-002h
**Part of:** [T-002](T-002-admin-branding-review-workflow.md)

## Context
On the report page the manager can edit the painter notes, tick or untick checklist items and add
a note to each, and write internal manager notes. Photos are shown as before, with no edit
controls. Two managers may have the same report open; the second to save must not overwrite the
first's work.

## Scenarios

### 1. Enter and leave edit mode
Given a manager opens a report
When they click "Edit report"
Then Painter notes and Manager notes become text areas, each checklist item shows a checkbox and
a note field (labels stay as text), photos are unchanged, and "Save changes" and "Cancel" appear
And Cancel with unsaved changes asks "Discard your changes?" and Cancel without changes just
leaves edit mode

### 2. Save an edit
Given the manager changes painter notes and ticks "Skirting boards gloss"
When they click "Save changes"
Then they see "Changes saved", the page shows the new values, the History panel has a new entry
at the top ("Sarah Whitfield changed Painter notes, Checklist: Skirting boards gloss"), and the
report version used for the next save is the new one

### 3. Warning before reopening a reviewed report
Given a reviewed report
When the manager clicks "Edit report"
Then a notice says "This report has been reviewed. Saving changes will return it to Awaiting
review."
And after saving, the badge reads Awaiting review, the "Reviewed by" line is replaced by
"Awaiting review", and the "Mark as reviewed" button is back; the History shows an edited and a
reopened entry

### 4. Conflict with another manager
Given Priya and Sarah have the same report open and Sarah saves a change to painter notes
When Priya then clicks "Save changes" with her own change to the same report
Then she sees "Sarah Whitfield changed this report at 11:40. Your changes were not saved."
And her typed text stays on screen, Sarah's current values are shown beside the affected fields,
and a "Reload latest" button discards Priya's edit form (after a confirmation) and shows the
latest report; no data of Sarah's is overwritten

### 5. Validation messages
Given the form
When painter notes exceed 5,000 characters, or a checklist note exceeds 500
Then a message with the limit appears beside the field, Save is disabled, and the counts update
as the manager types

### 6. Nothing changed
Given edit mode with no changes
Then "Save changes" is disabled

### 7. Failure keeps work
Given the save fails with 500 or the network drops
Then an error with "Try again" appears, the typed values stay, and no duplicate history entry is
created on retry

### 8. Unsaved changes protection
Given unsaved changes
When the manager clicks a navigation link or closes the tab
Then the browser or app asks for confirmation before leaving

### 9. Text is shown safely
Given notes containing `<b>bold</b> & "quotes"`
Then they are shown and edited as literal text, and long notes (1,000+ characters) do not break
the layout at 360px width

### 10. Who can edit
Given an admin or painter visits a report URL
Then the not-authorised page shows and no edit control exists
And given the API rejects the save with 403 mid-session, the page shows the error without
losing the typed text

## Out of scope
Photo editing, autosave and drafts, real-time collaboration indicators, rich text, restoring
earlier versions.

## Open questions
- None beyond T-002i.
