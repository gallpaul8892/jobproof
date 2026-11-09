# T-003c: My jobs today

**Persona:** Operative
**Depends on:** T-003b; needs a new operative-scoped jobs list (API implied)
**Part of:** [T-003](T-003-operative-app.md) (Q10, Q11)

## Context
First thing in the morning Dan wants to know where he is going and what is waiting. He must see
only his own jobs. "Today" is the Europe/London calendar day. Jobs from earlier days that were
never finished must not silently disappear.

## Scenarios (example data: Dan Hughes; seed must give him jobs for "today")

### 1. Today's jobs
Given Dan is assigned 3 jobs scheduled today: "Repaint lounge, hall and landing" (BS6 5QA),
"Paper bedroom feature wall" (BS8 2PX) and "Exterior repaint, front elevation" (BS3 1AB)
When he opens "My jobs"
Then he sees those 3 jobs in scheduled order, each with title, town, postcode, job type label
and status "To do"

### 2. Only my jobs
Given Priya Shah has jobs today that Dan does not
When Dan's list loads
Then none of Priya's jobs appear, and calling the jobs list for another operative's job id
returns "not found" to Dan (no hint that it exists)

### 3. Earlier unfinished jobs
Given Dan has a job scheduled yesterday with no submitted report
When he opens "My jobs"
Then it appears in a separate section "Earlier, not finished" below today's jobs

### 4. Job states shown
Given one job has a draft report with 6 of 9 checklist items done, and one has a submitted report
Then the first shows "In progress, 6 of 9 done" and the second shows "Submitted" and sits at the
bottom of today's list, greyed but readable

### 5. Empty state
Given Dan has no jobs today and none unfinished
Then he sees "No jobs today. Pull down to refresh." and no error

### 6. Pull to refresh and freshness
Given the list is showing
When Dan pulls down
Then the list reloads and "Updated 07:42" shows the time; a job the office just assigned appears

### 7. Cancelled or reassigned job
Given the office cancels one of Dan's jobs, or reassigns it to Priya, after Dan loaded the list
When Dan next refreshes
Then the job is removed or marked "Cancelled" (reassigned: removed), and if Dan has unsent photos
for it they are kept and shown under "Needs attention" (see T-003n scenario 7)

### 8. Slow and failed load
Given a slow network
When the list is loading
Then he sees placeholders (not a blank screen) and the last list if there is one
And on failure he sees "Couldn't load jobs. Check your signal." with Retry, and the last list stays visible

### 9. Offline list
Given Dan loaded the list at the depot and now has no signal
When he opens the app
Then the cached list shows with "Offline. Showing jobs from 07:42." (details in T-003i)

### 10. Long titles and many jobs
Given a job title of 120 characters and 14 jobs
Then titles wrap or truncate with no overlap, the list scrolls, and 200% text still works (T-003m)

## Out of scope
Calendar or week view, map view, route planning, accepting or declining jobs, searching,
other days' lists.

## Open questions
- Which jobs appear: default per Q10. A job that is `completed` by the office but has no operative
  report: default shows it as "Completed by office" and not startable.
