# T-002: Company branding, Admin persona, editable and reviewable reports (epic)

**Personas:** Admin (new), Manager
**This file is the parent record. The buildable tickets are T-002a to T-002m.**

## Phase change (read this first)
Phase 1 was **read-only, manager only, mock data**. **T-002 ends the read-only constraint.** From
this epic on, the web app has write endpoints: Admin settings, marking reports reviewed, and
editing report text and checklist. Photos stay read-only. Still out of scope: painter capture
(Expo), Stripe and customer payment, quotes and deposits flow, AWS deployment. CLAUDE.md
"Current phase" has been updated to say this.

## Customer requirements (from Paul) mapped to tickets
| # | Requirement | Tickets |
|---|---|---|
| 1 | Multi-tenant intent, first customer Arbour Services (tree surgeons, Glasgow) | T-002a (decision), T-002l, T-002m |
| 2 | Branding: default theme, Admin sets company name and colour scheme | T-002c, T-002d, T-002e |
| 3 | Admin persona, server-side authorisation | T-002b |
| 4 | Managers edit job reports, audit trail, optimistic concurrency | T-002f, T-002i, T-002j |
| 5 | Review workflow: awaiting review -> reviewed (who, when) | T-002g, T-002h |
| 6 | Dashboard queue of next 5 reports to review | T-002k |
| 7 | (2026-11-08) Managers correct customer contact details, audited | T-002n |
| 8 | (2026-11-08) After a conflict, re-apply my edits on top of the latest version | T-002o |

## Decisions (product owner; the architect designs the "how")

### D1. One deployment per company, configured by a settings row; multi-tenancy later
Recommendation: **one deployment (own database, own domain) per company for now**, with the
company's name and colour scheme held in a **single settings record** that the Admin edits at
runtime. Reasons: Arbour is the only customer; per-company deployment gives hard data isolation
for free (no tenant-leak class of bug, no per-query tenant filter); it needs no tenant model,
no tenant-aware auth, no per-tenant URLs. It does not block true multi-tenancy later if these
rules hold (they are testable in T-002a):
1. Company name and theme are read only through one settings accessor; no company name or colour
   is hard-coded outside one defaults module (and the seed/tests/docs).
2. No table or API field is named after a company; no assumption that there is only one company in
   *code paths* (only in the settings table, which is one row today).
3. Adding multi-tenancy later is then mechanical: add `tenant_id` to settings and to each table,
   resolve the tenant from host name or login, and scope queries. Not built now.
Trade-off accepted: each new company costs a deployment (infra ticket in the AWS phase, scripted).

### D2. Roles
One role per user (`manager`, `painter`, plus new `admin`). **Admin is a separate persona that
sees Settings only; it does not get manager data.** A person who needs both has two accounts.
Least privilege now; widening later is easy, narrowing is not.
**Confirmed by Paul 2026-11-08:** Admin and Manager stay separate because an Admin may be
technical staff, not a manager. Admin never reads or changes reports, customers or billing.

### D3. Review workflow
A report is `awaiting_review` or `reviewed` (already in the data model). A manager marks it
reviewed explicitly; the system records who and when. **Editing a reviewed report returns it to
awaiting review** (reviewer fields cleared, previous reviewer kept in the audit trail), because
"reviewed" means "this content was approved". Editing a report that is already awaiting review
keeps it awaiting. Marking reviewed requires the version the manager saw, so nobody approves
content they did not read.

### D4. What managers may edit
Editable: `painter_notes`, each checklist item's `done` and `note`, and a new internal
`manager_notes` field (so a manager can annotate without rewriting the painter's words).
Not editable: checklist labels, adding or removing checklist items, photos (read-only for now),
job details, customer, billing, completion date. Every change is audited with old and new values.
**Amended by Paul 2026-11-08 (T-002n):** managers may also correct a customer's contact details
(name, contact name, email, phone, billing address), audited with who/when/old/new. Ids, customer
type, payment terms and job/photo/checklist data stay read-only. A customer edit does not reopen
reviewed reports; it shows in each affected report's history.

### D5. Concurrency
Optimistic: each report has an integer `version` (starts at 1, +1 on every real change including
review). Writes carry the version the manager loaded; a mismatch is a 409 and nothing is saved.

### D6. Branding and colour validation
Default theme is one theme object: dark green primary (header, primary buttons), dark green accent
(links, focus), white page background, near-black text. Formal and minimal, in the spirit of
Amazon or eBay but simpler. The Admin can override company name (default "Arbour Services") and
the colour scheme (primary + accent). **Colour choices that fail WCAG 2.2 AA contrast are
rejected** (not merely warned): primary and accent must each reach at least 4.5:1 against white,
because primary carries white text and accent is used for links on white.

### D7. Industry wording
The mock data is painting and decorating; Arbour does tree surgery. UI wording becomes
industry-neutral now (T-002l, small). A tree-surgery mock dataset (T-002m) is optional and does
not block anything.

## Recommended build order
1. T-002a settings + branding endpoint (foundation, also the deployment decision)
2. T-002b Admin role, authorisation, seed accounts, Settings page shell
3. T-002c company name editable and applied everywhere
4. T-002d default theme applied everywhere
5. T-002e Admin chooses colour scheme with AA validation
6. T-002k dashboard review queue (works on existing data; can run in parallel with 3 to 5)
7. T-002g review API (adds `version`), then T-002h review UI
8. T-002f audit trail foundation (before edit), then T-002i edit API, then T-002j edit UI
9. T-002l neutral wording; T-002m tree-surgery mock data (deferrable)
10. T-002n manager edits customer details, then T-002o "Apply my changes on top" (Package 4)

Branding (1-5) and the review/edit stream (6-8) touch different code and can be built in parallel
by two engineers after T-002a/T-002b. T-002f also records Admin settings changes, so it follows
T-002c and T-002e.

## Impact on existing tickets and tests
- T-001b scenario 3 ("7 users, 1 manager") and the demo-accounts expectations change: 9 users
  (2 managers, 6 painters, 1 admin). T-002b updates those tests.
- T-001c scenario 3 (every `/manager/` operation rejects non-managers) must now include the admin
  token. T-002b updates it.
- ARCHITECTURE.md section 7 (permissions) and the "backlog suggests T-002a hardening" reference
  (B1, B2) clash with this numbering: the architect should re-label the hardening ticket T-003.

## Out of scope for the epic
Logo upload, user management screens (creating or deactivating users), email notifications,
editing photos, invoice gating on review, tenant model, per-company domains, Stripe, mobile.

## Open questions for Paul
See the reply that accompanied these tickets; each ticket also lists its own, with the default
assumed.
