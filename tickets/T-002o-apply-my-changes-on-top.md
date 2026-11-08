# T-002o: "Apply my changes on top" after an edit conflict

**Persona:** Manager
**Owner:** frontend-engineer (test-engineer for e2e). No API change.
**Depends on:** T-002j (report edit conflict view), T-002n (customer edit conflict view)
**Part of:** [T-002](T-002-admin-branding-review-workflow.md), Package 4. Decision by Paul,
2026-11-08.
**Spec:** [specs/T-002o.md](../specs/T-002o.md)

## Context
When two managers edit the same report or customer, the second save is refused (T-002j, T-002n)
and today the only way forward is "Reload latest", which throws away the second manager's typing.
Usually the two managers changed different things, so their work could simply be combined. "Apply
my changes on top" loads the latest version and re-applies only the fields this manager edited.
Where both managers changed the same field, the manager decides per field: keep mine or keep
theirs. Nothing is saved until the manager clicks "Save changes" again.

## Scenarios

### 1. The option is offered next to "Reload latest"
Given Priya's save of report JP-1042 was refused because Sarah Whitfield changed it first
Then the conflict message shows two buttons: "Apply my changes on top" and "Reload latest"

### 2. Different fields: merged without questions
Given Priya loaded JP-1042 at version 3 and changed only Manager notes to "Customer asked for
invoice by email."
And Sarah then changed only Painter notes (version 4)
When Priya clicks "Apply my changes on top"
Then the form shows Sarah's new painter notes and Priya's manager notes, a notice reads "Your
changes were re-applied to the latest version (changed by Sarah Whitfield at 11:40). Check them
and save.", nothing has been saved yet, and "Save changes" is enabled
And when Priya saves, the report is version 5 with both changes and the history shows Sarah's
edit and then Priya's

### 3. Same field: the manager chooses
Given Priya and Sarah both changed checklist item "Skirting boards gloss" note, Priya to "Done 16
Oct" and Sarah to "Second coat 17 Oct"
When Priya clicks "Apply my changes on top"
Then that field shows "Changed by you and by Sarah Whitfield" with the two values and a choice
"Keep mine" / "Keep theirs", other fields Priya changed are re-applied, and "Save changes" stays
disabled until every such field has a choice

### 4. Keep theirs on every clash leaves nothing to save
Given the only field Priya changed was also changed by Sarah
When Priya chooses "Keep theirs"
Then the form equals the latest version, "Save changes" is disabled and the notice says "Nothing
left to save: the latest version already has the values you kept."

### 5. Both made the same change
Given Priya and Sarah both ticked "Skirting boards gloss" done
When Priya clicks "Apply my changes on top"
Then that field is not shown as a clash (the values agree), and it is not sent again

### 6. Works for customer details too
Given Priya changed Harbourside Lettings Ltd's email and Sarah changed its phone first
When Priya clicks "Apply my changes on top" on the customer page
Then the form shows Sarah's phone and Priya's email, ready to save
And if both changed the email, Priya chooses "Keep mine" or "Keep theirs" for the email

### 7. The latest version was reviewed meanwhile
Given Sarah marked JP-1042 reviewed after Priya loaded it
When Priya applies her changes on top
Then the warning "This report has been reviewed. Saving changes will return it to Awaiting
review." is shown before she saves

### 8. Another conflict while merging
Given Priya applied her changes on top and Sarah saves again before Priya does
When Priya clicks "Save changes"
Then the conflict message appears again with both buttons, and applying on top uses the newest
version (Priya's choices made so far are kept as her values)

### 9. Loading the latest version fails
Given Priya clicks "Apply my changes on top" and loading the latest version fails (500 or network)
Then an error with "Try again" appears and Priya's typed values and the conflict view are unchanged

### 10. "Reload latest" still discards
Given the conflict view
When Priya clicks "Reload latest" and confirms "Discard your edits and load the latest version?"
Then her edits are discarded and the latest version is shown (unchanged T-002j/T-002n behaviour)

### 11. Accessible choices
Given a clashing field
Then the "Keep mine" / "Keep theirs" choice is a labelled radio group named after the field,
reachable by keyboard, and long values (1,000+ characters) wrap without breaking a 360px layout

## Out of scope
Automatic saving after merging, merging inside one text field (character level), live presence
indicators, merging photo or review changes.

## Open questions (defaults applied)
- Save automatically when there is no clash? Default: **no**; the manager always checks and saves,
  because the result is content nobody has seen yet (and may reopen a reviewed report).
- Which option is primary? Default: "Apply my changes on top" is the primary button, "Reload
  latest" secondary, because it never discards work.
</content>
</invoke>
