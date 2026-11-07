# T-002h: Review a report in the web app

**Persona:** Manager
**Owner:** frontend-engineer (test-engineer for e2e)
**Depends on:** T-002g
**Part of:** [T-002](T-002-admin-branding-review-workflow.md)

## Context
After checking the photos and checklist, the manager clicks one button to say "I have reviewed
this". The report then shows who reviewed it and when. Because two managers may open the same
report, a stale page must not silently approve content the manager did not see.

## Scenarios

### 1. Review button on an awaiting report
Given a manager opens an awaiting-review report
Then the Painter section shows "Awaiting review" and a "Mark as reviewed" button
When they click it
Then the button shows progress, then the section reads "Reviewed by Priya Nair on 15 Oct 2026,
11:42" (London time), the badge changes to Reviewed and the button disappears

### 2. Reviewed report shows who and when
Given a seeded reviewed report
Then the page shows "Reviewed by Sarah Whitfield on <date>" and no review button

### 3. Lists and dashboard reflect it
Given Priya reviews a report
When she returns to Reports and the dashboard
Then the row shows Reviewed and "Reports awaiting review" is one lower (no manual refresh
needed beyond navigating)

### 4. Someone else reviewed it first
Given Sarah and Priya have the same awaiting report open and Sarah reviews it
When Priya clicks "Mark as reviewed"
Then she sees "Sarah Whitfield already reviewed this report at 11:40", the page updates to the
reviewed state, and Priya's click does not change reviewer or time

### 5. The report changed since it was loaded
Given Priya has a report open at version 1 and Sarah edits it (version 2)
When Priya clicks "Mark as reviewed"
Then she sees "This report changed while you were looking at it. Reload to see the latest
version before reviewing", nothing is reviewed, and a "Reload report" button shows the latest

### 6. Failure and resilience
Given the review request fails with 500 or the network drops
Then an error with "Try again" appears, the report stays awaiting, and the button can be pressed
again without a double review

### 7. Double click is safe
Given the manager double-clicks "Mark as reviewed"
Then only one request is sent and one review is recorded

### 8. Keyboard and screen reader
Then the button is reachable by keyboard, and the result is announced (status role) not only
shown visually

### 9. Other personas
Given an admin or painter visits a report URL
Then they see the not-authorised page and no review control (unchanged from T-001d)

## Out of scope
Bulk review, "Review and next" shortcut, undo, comments.

## Open questions
- A "Mark reviewed and open next in queue" button would speed up the weekly pile. Default: not
  now; raise after Paul has used the queue.
