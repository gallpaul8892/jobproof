# T-002m: Tree-surgery mock data profile (switchable seed) -- deferrable

**Persona:** Developer (internal), for demos to Arbour Services
**Owner:** backend-engineer (architect decides how job types stop being a painting-only enum)
**Depends on:** T-002l
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decision D7
**Status:** optional; **does not block any other T-002 ticket**. Build only if Paul wants to demo
to Arbour with relevant data.

## Context
Mock data is painting and decorating (interior repaint, wallpapering...). A demo to a tree surgeon
is more convincing with tree-surgery data. The seed gains a **profile** chosen at seed time; the
default stays `painting` so every existing test is untouched. The shape (60 jobs, 60 reports, 9
awaiting review, 52 invoices, the same status distribution and edge cases) is identical in both
profiles.

Tree-surgery content for the profile (UK, Glasgow and Central Belt addresses):
- Job types: crown reduction, felling, stump grinding, hedge trimming, TPO/conservation area
  check, emergency storm clearance, commercial grounds clearance.
- Checklist items: "Site risk assessment completed", "Exclusion zone set up", "Brash chipped and
  removed", "Arisings left tidy", "Stump ground to 300mm", "Neighbour notified".
- Photo captions: "Before: oak overhanging garage", "During: sectional dismantle", "After: crown
  lifted, 2m clearance".

## Scenarios

### 1. Profile is selected at seed time
Given `SEED_PROFILE=tree_surgery` and APP_ENV local or test
When `python -m app.seed` runs
Then the database holds 60 jobs with tree-surgery job types, titles, checklists and captions, no
painting wording, Glasgow-area addresses and GBP amounts, and the same counts and invoice status
distribution as the painting profile

### 2. Default is unchanged
Given `SEED_PROFILE` is unset
Then the painting dataset is produced and all T-001b/c/d tests pass unmodified

### 3. Profile is deterministic and consistent
Given the tree-surgery profile for anchors 2026-10-15, 2026-11-01 and 2027-03-31
Then seeding twice gives identical rows and the T-001b consistency checks pass

### 4. UI shows the right labels
Given the tree-surgery profile
When the manager opens Reports and a report
Then job-type labels (for example "Crown reduction"), the filter options and the detail page
show tree-surgery wording, and the "Operative" chrome from T-002l is unchanged

### 5. Guard rails
Given an unknown profile name
Then the seed refuses with a clear error; and the seed still refuses outside local and test

### 6. Placeholder photos
Given tree-surgery reports
Then placeholder photos remain generated offline (stage label, job reference, caption) as in
T-001b scenario 8

## Out of scope
Per-company job-type management screens, importing real data, real Arbour photos.

## Open questions
- Is a demo with tree-surgery data wanted soon? Default: deferred; ship T-002l first.
