# T-004: Company hierarchy, split jobs and tiered invoicing (epic)

**Personas:** Contractor (top company, owns the deployment), Subcontractor (any depth below),
Operative (field, mobile app), Admin (a permission held within one company, not a global role; see
PD3). Customer is unchanged.
**This file is the parent record. The buildable tickets are T-004a to T-004p.**
**Status: Phase 3, not started.** Revised 2026-11-22 with Paul's answers (see "Decisions from Paul
(2026-11-22)"). Nothing here is built. It is built **after** the Operative app (T-003) is
demoable (PD4).

## Prerequisites from T-003 (Operative app)
This epic does not start until the following are done and demoed on an Android device. "Demoable"
means an operative can sign in, see a job, take photos, tick the checklist and submit a completion
report, and a manager sees it on the web.
| Ticket | Why this epic needs it |
|---|---|
| [T-003a](T-003a-app-shell-and-build.md) | The app shell and build that T-004h extends |
| [T-003b](T-003b-operative-sign-in.md) | Operatives from other companies must sign in (T-004d) |
| [T-003c](T-003c-my-jobs-today.md) | "My jobs" becomes "my allocations" (T-004h) |
| [T-003d](T-003d-job-detail-and-checklist.md) | The allocation screen reuses job detail and checklist (T-004h) |
| [T-003e](T-003e-capture-photos.md), [T-003f](T-003f-checklist-progress-notes-item-photos.md), [T-003g](T-003g-photo-upload-and-sync-status.md) | Evidence for the leaf job that quantity done sits beside |
| [T-003h](T-003h-submit-completion-report.md) | Submitting the report is the moment done quantity is recorded (T-004h) |
Recommended before release to real subcontractors, not blocking the start: T-003l (permissions and
privacy) and T-003n (error states and session expiry).

## Why (Paul's brief, in his words, tidied)
A contractor has subcontractors working for him; they have their own subcontractors, and so on to
any depth. The product must show that as a hierarchy of **companies** and **people**. The
subcontractor level does not need that name in the screens: the action is **"Add a company"**.
When you add a company you can add people to it, or add a company to a company and then add
people to that. Work (tasks, measured quantities) is **split down the hierarchy**, progress
**rolls up**, and invoices have **depth**: each level's invoice is built from the invoices of the
level below, and every invoice records its level. A company's Admin sees progress across its own
subtree and invoices only as the visibility rule allows (own and direct children's); nobody sees
across branches or upwards (PD2, PD3).

## Phase and scope warning (read first)
- CLAUDE.md says Phase 2b (T-003, Operative app) is next, and that Stripe, quotes and deposits are
  out. **This epic is Phase 3, not started, and is not in the current phase.** The orchestrator
  must update CLAUDE.md "Current phase" when it begins; the product owner does not edit CLAUDE.md.
  It must not start before the T-003 prerequisites above are demoable, because the operative app
  is what ticks work off (PD4).
- **Ticket number clash (action for the architect):** ARCHITECTURE.md (B1, B2, line "relabelled
  2026-11-09") reserves "T-004 hardening". T-004 now belongs to this epic, so **the architect must
  relabel that hardening backlog to T-005** in ARCHITECTURE.md. Not done by the product owner
  (ARCHITECTURE.md is the architect's file, and this revision did not edit it).

## Decisions from Paul (2026-11-22)
Cited in tickets as PD1 to PD4 (to avoid clashing with T-002 D1 to D3).

**PD1. Pricing.** The company that makes a split (the allocator) sets a **rate per unit** on each
allocation it makes. A company's invoice is **its own work plus the invoices of the level below**
(its direct children), nothing else counted twice. Beside the invoice total the page shows a **rate
check** (agreed rate x done quantity against the invoice total). It **warns and never blocks**.

**PD2. Visibility of money (Paul's words).** "The admin for each company can only see theirs and
below. Nobody can ever see what anyone else charges the customer or pays the workers; they only
know what they invoice and what their immediate children invoice. If we refer to contractor A,
subcontractor B and subcontractor C, and B works for A and C works for B: as A I should see the
group of all my B's put together into one report that I can send out to the customer to charge. As
A, I can't see what B's paying C; I can only see what B wants to be paid by me, and a roundup of
all the work B has done, as a summary. As B, I can see what all my C's have done, so each C would
have their job and their invoice, and they send that to me because I have to pay the individual
C's, but A is not interested in what I paid the individual C's. They just want to know what I need
to charge them so they can get all their invoices from the B's together and send them to the
customer."
Product owner's reading, which the tickets now follow:
- Invoice and rate visibility is **exactly: own invoices plus immediate children's invoices, and
  the rates agreed with those children** (and a company's own rate from its parent).
- A company **never** sees a grandchild's invoice or rate, a parent's other dealings, a sibling's,
  or what anyone charges the customer other than itself (A, for the customer invoice).
- A, the top contractor, can produce **one report and invoice for the customer that groups all its
  direct subcontractors' invoices**: what each B charges A, plus a summary of the work done,
  without any C-level amount (T-004n).
- B sees each C's job work and each C's invoice in full, because B pays them. A sees B's total and
  a work summary, never what B pays C.

**PD3. Admin is not a global role.** "The admin for a company can only see the jobs that company
has. As admin for subcontractor B, I can't look at another subcontractor's progress on the job, nor
see everything A can see. If I'm the contractor A, I can see the progress of the jobs across all the
B's, and that comes from the jobs across all the C's: each C does the work, it rolls up into B and
keeps the report updated, and B rolls up into A, where I can monitor the progress of each job and
how many units have been completed."
Product owner's reading:
- **Admin** is a permission held **in one company**. A company's Admin sees **progress for its own
  subtree** (every depth below it; units done against units allocated; **no prices**). No
  cross-branch and no upward visibility.
- **Progress and money are different rules.** Progress visibility goes down the **whole subtree**.
  Money visibility goes only to **direct children** (PD2). A sees units done by the C's and the
  operatives below B, but never what they are paid or invoice.
- **Reconciling with T-002.** The existing global Admin (Tom Ashworth, who owns company name and
  colour scheme settings) becomes the **Admin of the root company, Arbour Services**. The Settings
  screens (name, colours) stay with the root company's Admin only: one brand per deployment, no
  per-subcontractor branding (out of scope). Subcontractor Admins have no Settings screen.
- **What happens to T-002 D2 ("Admin never reads billing").** Replaced. The Admin of a company
  manages that company's people and companies (T-004c, T-004d), sees progress in its subtree
  (T-004j), and sees invoices **own and direct children's only** (T-004p), read-only. It still does
  **not** see photos, report text or customer contact details unless the same person also holds
  the manager permission. It cannot approve, issue or edit an invoice or job. The old "global
  oversight of every invoice and every level" idea (the earlier T-004j and T-004p) is withdrawn.

**PD4. Timing.** Built **after** the Operative app (T-003) is demoable. Epic status: Phase 3, not
started. Prerequisite T-003 tickets are listed at the top of this file.

## Decisions this epic overturns or amends (flagged for Paul)
| Existing decision | What changes | Recommendation |
|---|---|---|
| **T-002 D1** one deployment per company, multi-tenancy later | **Not overturned.** A deployment now holds one *company tree* whose root is the Contractor who owns it. Subcontractors are companies *inside* that tree, not tenants. Tenant isolation between unrelated contractors is still done by separate deployments. D1 rule 2 ("no assumption of a single company in code paths") is exactly what this needs. Consequence: two contractors who share a subcontractor are two deployments and the subcontractor has two accounts. | Keep D1. Flag the consequence to Paul. |
| **T-002 D2** one role per user; Admin sees Settings only and "never reads or changes reports, customers or billing" (confirmed by Paul 2026-11-08) | **Replaced by PD3 (Paul, 2026-11-22).** Admin is no longer global: it is a permission within one company. The old Admin (Tom Ashworth) becomes Admin of the root company and keeps Settings. A company's Admin manages its people and companies, sees progress across its own subtree, and sees invoices only as PD2 allows (own and direct children's). Still no photos, report text or customer contacts unless the person is also a manager. "Role" also becomes a person's role *in a company*. | Done: confirmed by Paul. T-002b scenario 4 (Admin gets 403 on `/manager/` operations) still holds for an Admin who is not also a manager. |
| **T-002 D3** managers review reports | Unchanged in behaviour. "Manager" becomes "a Contractor or Subcontractor user with the manager permission in their company". Review is by someone in the operative's own company or above it (T-004b). | Keep. |
| **T-003 Q13/Q11** operative sees customer phone for assigned jobs | Unchanged, but "assigned" now means allocated to that person (T-004h). | Keep. |
| **B13** no user management, users from seed or CLI | **Becomes blocking.** "Add a company" and "add people" are user management. | Pulled into T-004c and T-004d (minimum only). |
| **B12** invoices have no name/address snapshot | **Becomes blocking** for issued invoices between companies. | Snapshot at issue, T-004o. |

## Roles and what they are
Role is held **in a company** (membership). One person belongs to one company (default, Q7).
- **Contractor:** the top company's users. "Owns the deployment". The existing Manager persona
  becomes a Contractor user with the manager permission. The existing company settings
  (name, colours) belong to this company.
- **Subcontractor:** users of any company below the top. Same screens as a Contractor but scoped to
  their own company and everything under it. (Their company may be a sole trader of one person.)
- **Operative:** does the work in the mobile app. Belongs to a company at any level. In code the
  role value stays `painter` (B9); UI says "Operative".
- **Admin:** a permission held in one company (PD3), not a global account. Sees that company's
subtree for progress, and own and direct children's invoices (read-only); manages its people and
companies. Tom Ashworth is Admin of Arbour Services and the only person with Settings (name,
colours). One person may hold Admin and manager together (default, Q16).
A company has **managers** (can add companies/people, allocate work, review, approve invoices),
**admins** (above) and **operatives**. Whether a manager may also be an operative is Q7.

## Permissions matrix
"Own" = the user's company. "Subtree" = own company plus every company and person below it.
"Parent" = the company directly above. "Siblings" = companies with the same parent.
Y = yes, R = read only, N = never (server returns 403 or 404, not hidden in the UI only).

Admin is a permission in a company, so it is shown as a modifier on each company column rather
than a separate global column. "Admin (any company)" means a user who holds Admin and is not also a
manager; a user who holds both gets the union of both columns.

| Capability | Contractor (manager) | Subcontractor (manager) | Operative | Admin (any company, not also manager) |
|---|---|---|---|---|
| See company tree | R whole tree | R own subtree only; own company's parent shown as name only | N | R own subtree only; parent as name only |
| Add a company | Y under own company or any company in subtree | Y under own company or any in own subtree | N | Y in own subtree (default, Q14) |
| Add / deactivate people | Y anywhere in subtree | Y in own subtree | N | Y in own subtree (default, Q14) |
| Settings (company name, colour scheme) | N | N | N | **Y for the root company's Admin only**; none elsewhere |
| See siblings, ancestors' other data, or other branches | n/a | **N** | N | **N** |
| Create a job (root) for a customer | Y | N | N | N |
| Split a job into allocations | Y on root jobs and any allocation in subtree | Y on allocations given to own company or below | N | N |
| Re-assign / withdraw unfinished quantity | Y in subtree | Y on allocations they made | N | N |
| Set a rate on an allocation | Y on allocations it makes | Y on allocations it makes | N | N |
| See a rate | Rates it gives to its **direct children** only | Own rate from its parent, and rates it gives to its **direct children**; **never grandchildren's, a parent's other rates, or another branch's** | N (default, Q1a) | Same as the company's managers, read only |
| Record work done (tick off) | N | N | Y on own allocations only | N |
| See progress (units done vs allocated, **no prices**) | **Whole subtree, every depth** | **Own subtree, every depth** | Own allocations | **Own subtree, every depth** (read only) |
| Review reports (T-002) | Y whole tree | Y reports of own subtree | N | N |
| See report photos and customer details | Y whole tree | Y own subtree reports; customer contact only for jobs in own subtree | Own jobs (T-003) | N |
| Raise an invoice | Y (to the customer, level 0, grouping its direct children's invoices) | Y (to parent) | Y if invoicing operative (Q12) | N |
| See an invoice | **Own, plus those received from direct children (in full).** Never a grandchild's | **Own, plus those received from direct children (in full).** Never a grandchild's, parent's or sibling's | Own | **Own, plus those received from direct children**, read only |
| See the work summary on a direct child's invoice | Y (jobs, quantities, that child's amounts); no amounts from below that child | Y for its children | N | Y, read only |
| Approve a child's invoice | Y for direct children | Y for direct children | N | N (default, Q17) |
| Edit an issued invoice | **N** (immutable) | **N** | N | **N** |

Rule of thumb for privacy, two separate rules (PD2, PD3):
- **Progress (units, no prices) goes down the whole subtree.** The Contractor sees every C and every
  operative's units done; B sees its subtree; nobody sees across or up.
- **Money goes only between a company and its direct children** (and the company's own invoice to
  its own parent). A company never sees its grandchildren's rates or invoice amounts. A never sees
  what B pays C; B never sees what A charges the customer. Nobody sees what anyone else charges
  the customer or pays the workers.

## Data concepts, in plain words (architect designs the shapes)
- **Company tree:** companies form a tree with one root (the Contractor). Each company has a name,
  a parent, and a **level** (root = 0, its direct subcontractors = 1, and so on). Companies are
  deactivated, never deleted, once they have jobs or invoices.
- **Membership:** a person belongs to a company with a role there (manager or operative). A person's
  company, and so their level, shows in the audit trail with who/when.
- **Job and allocation:** the *job* is the customer's piece of work at a site (existing concept,
  with tasks and checklist). An **allocation** hands a **quantity** of it, with a **unit**, to one
  company or one person. Example: job "Repaint external walls, Riverside Court, Leeds" is 2,000 m;
  Arbour Services allocates 1,000 m to "Kessock Decorating Ltd" and 1,000 m to "Dunmore Painters";
  Kessock allocates 100 m to Dan Hughes, 100 m to Aisha Rahman, and so on. Allocations nest, so
  every allocation has one parent allocation and the whole job is one tree. The work description
  and checklist are the same all the way down; only quantity and assignee change.
- **Unit:** a unit of measure fixed for the whole job at the top (metres, sq m, rooms, hours,
  items, "whole job"). Children use the same unit; no conversion in this epic (Q9).
- **Sum rule:** children of an allocation may not total more than their parent (over-allocation is
  blocked). Less is allowed; the remainder is "not yet allocated" and visible (Q3).
- **Progress rollup:** an operative records quantity done on a leaf allocation. Each level's
  progress is the sum of done quantities below it against that level's allocated quantity, e.g.
  "300 of 1,000 m". Progress is calculated from the leaves, never typed in at higher levels.
- **Invoice level and rollup:** every invoice records its **level**: the level of the issuing
  company (Contractor to customer = 0, a first-level subcontractor to the Contractor = 1, and so
  on); an operative's own invoice is one level below their company. An invoice is addressed to the
  issuer's parent. A company's invoice is built from **lines for work done** at its agreed rate
  plus **lines pulled from approved invoices of its direct children**, tagged to the jobs (PD1).
  The parent sees a child's invoice as that child's total and a job-by-job work summary; what the
  child pays its own children is never shown upward (PD2). Totals are integer pence GBP, shown
  excluding VAT (Q6).
- **Rate check:** beside each invoice total, agreed rate x done quantity is compared with the
  invoice total. A difference shows as a warning and never blocks (PD1).
- **Immutability:** once issued, an invoice and its lines never change. Mistakes are fixed by a
  credit note and a new invoice (Q5 default), each linked to the original. Issued invoices carry a
  snapshot of both companies' names and addresses (B12).

## Journey (what the tickets follow)
1. Contractor manager opens Companies, sees the tree, clicks "Add a company" and adds "Kessock
   Decorating Ltd" under Arbour Services (T-004c); adds people to it (T-004d).
2. Kessock's manager signs in, sees only Kessock and below, adds "Dunmore Subcontract Painters" to
   its own tree and people to that.
3. Contractor splits a 2,000 m job into 1,000 m + 1,000 m (T-004f); each subcontractor splits
   further down to individuals; rates set at each step (T-004k).
4. Operatives see their allocation in the mobile app, work it and record metres done (T-004h);
   each level sees "300 of 1,000 m" (T-004i); each company's Admin sees progress across its own
   subtree (T-004j).
5. Operatives invoice (T-004m), subcontractors roll them up (T-004n), parents approve, issue
   (T-004o); the contractor's customer invoice is level 0 and groups its direct subcontractors'
   invoices (T-004l, T-004n); a company's Admin sees own and direct children's invoices (T-004p).

## Tickets and recommended build order
| Order | Ticket | Slice | Demo | Depends on |
|---|---|---|---|---|
| 1 | [T-004a](T-004a-company-tree-and-membership.md) | Company tree and membership; existing data moves under one root | Contractor sees a tree with Arbour Services and its 9 people | T-002b, T-002f |
| 2 | [T-004b](T-004b-subtree-scoped-access.md) | Subtree-scoped authorisation on every endpoint | A subcontractor cannot read a sibling | T-004a |
| 3 | [T-004c](T-004c-add-a-company.md) | "Add a company" | Add "Kessock Decorating Ltd" under the Contractor | T-004b |
| 4 | [T-004d](T-004d-add-people-to-a-company.md) | Add and deactivate people in a company | Add Aisha Rahman to Kessock; she signs in | T-004c |
| 5 | [T-004e](T-004e-demo-company-tree-seed.md) | Demo tree seed, 4 levels deep | `make seed` gives a realistic tree | T-004d |
| 6 | [T-004f](T-004f-split-a-job-into-allocations.md) | Split a job down the hierarchy with quantities and units | 2,000 m becomes 1,000 + 1,000 | T-004e |
| 7 | [T-004g](T-004g-reassign-and-withdraw-work.md) | Re-assign or withdraw unfinished quantity | Move 40 m from one person to another | T-004f |
| 8 | [T-004h](T-004h-operative-works-an-allocation.md) | Operative sees and ticks off an allocation | Dan records 60 of 100 m done | T-004f, T-003c, T-003d, T-003h |
| 9 | [T-004i](T-004i-progress-rollup-per-level.md) | Progress rollup at every level | Kessock sees 300 of 1,000 m | T-004h |
| 10 | [T-004j](T-004j-admin-progress-all-levels.md) | A company's Admin sees progress across its own subtree (file name kept for stable links) | Tom sees the whole tree's progress; Kessock's Admin sees Kessock's subtree only | T-004i, T-004b |
| 11 | [T-004k](T-004k-rates-and-price-visibility.md) | Rate per unit set by the allocator; rates visible to direct children only | Kessock sees its own rate and its children's, not Rowan's children's | T-004f |
| 12 | [T-004l](T-004l-invoice-level-and-existing-invoices.md) | Every invoice has a level; existing invoices become level 0 | Billing shows "Level 0" | T-004a |
| 13 | [T-004m](T-004m-operative-level-invoice.md) | Operative-level invoice from work done | Dan's invoice: 60 m at £6.50 | T-004k, T-004l, T-004i |
| 14 | [T-004n](T-004n-roll-up-invoice-from-lower-invoices.md) | Company invoice rolled up from direct children's invoices; contractor's grouped customer invoice | 3 workers into 1 company invoice; Arbour groups its 5 subcontractors' invoices into one customer report | T-004m |
| 15 | [T-004o](T-004o-approve-issue-and-immutability.md) | Approval, issue, immutability, credit notes | Issued invoice cannot be edited | T-004n |
| 16 | [T-004p](T-004p-admin-all-invoices-view.md) | A company's Admin sees own and direct children's invoices, read only (file name kept) | Tom sees Arbour's and its direct subcontractors' invoices, not Rowan's | T-004o, T-004b |

Notes on order:
- **Streams after T-004e:** work (f to j) and money (k to p) share only T-004f (allocations) and
  T-004i (done quantity). T-004k and T-004l can start in parallel with T-004g to T-004i.
- **Smallest useful release:** a to f plus h and i (structure, split, progress) before any invoice
  tier. Invoicing is the highest-risk part and should not block the progress story.
- T-004a and T-004b must land before anything else because every later query is subtree-scoped.
- T-004g, T-004j and T-004p are the first to cut if time is short (T-004j and T-004p are Admin
  read-only views).
- The whole epic starts only after the T-003 prerequisites listed at the top (PD4).

## Impact on existing tickets and docs
- T-002 D1 kept, D2 replaced by PD3 (table above). T-002b scenario 4 ("Admin gets 403 on all
  `/manager/` operations") still holds for an Admin who is not also a manager; the new Admin reads
  of progress and invoices are separate endpoints scoped to the Admin's own company and subtree.
  T-002 Settings (name, colours) now belong to the root company's Admin.
- CLAUDE.md persona list ("Admin (company settings)") will need the Admin wording updated when
  this phase starts; not edited here.
- T-001b/T-002b seed expectations (9 users, 60 jobs, 52 invoices) hold: the 52 invoices become
  level 0, the 9 users get memberships (T-004a, T-004l).
- T-003c to T-003d "my jobs" lists allocations assigned to the operative once T-004h lands; before
  then it lists jobs directly (unchanged). T-003h "submit report" is unchanged: the report is still
  evidence for the leaf job; quantity done is added alongside it (T-004h).
- ARCHITECTURE.md needs a new section; the architect decides tables, endpoints and the rollup
  approach. Not designed here.

## Risks
1. **Scope jump:** this is bigger than T-002 and T-003 together; money flows between companies are
   regulated (CIS, VAT reverse charge). Mitigation: release in two stages (work, then invoices);
   awareness items are questions, not features.
2. **Privacy leaks by depth:** one missing filter shows a grandchild's invoice or a sibling's rate.
   Two different scopes (progress: whole subtree; money: direct children only) make mixed-up
   filters likely. Mitigation: T-004b first, with a test that enumerates every endpoint as every
   role at every level and proves A cannot read C's invoices or rates, B cannot read A's, and
   siblings see nothing.
3. **Rollup performance and correctness** at depth with many operatives; progress and invoice totals
   must always equal the sum of the leaves. Mitigation: acceptance scenarios assert sums exactly.
4. **Money rounding:** quantity to 2 decimal places times a pence rate. Rule: round half up to the
   whole penny once per line, never per total.
5. **Changing the tree under live work:** moving or deactivating a company with allocations or
   unpaid invoices. Mitigation: deactivate only; no moves (Q7, T-004g).
6. **Operative app collision:** T-003 is in flight and its "my jobs" assumes jobs are assigned
   directly. T-004h is the only ticket that touches the app and must follow T-003h.
7. **Wrong mental model:** painters measure in m² and rooms more than metres. Units are data; the
   2,000 m example is Paul's, and the demo uses both.
8. **Customer privacy:** subcontractors see customers' sites and contacts only for their own
   subtree jobs.

## Out of scope for the epic
Stripe and any payment between companies, bank transfers and remittance, CIS deduction statements,
VAT calculation and the reverse charge (awareness only, Q6), true multi-tenancy (D1), a person
in several companies, moving a company to a new parent, unit conversion, time sheets, quotes and
deposits, email or push notifications, accounting-software export, subcontractor self-registration
or invitations by email, company logos per subcontractor (one brand for the deployment), purchase
orders and materials.

## Open questions for Paul
Each has a recommended default; work proceeds on the default unless Paul answers. Tickets cite them
as Q-n. **Answered 2026-11-22 and removed:** Q1 (pricing and who sees it, now PD1 and PD2, with
the operative part left as Q1a) and Q15 (Admin limits, now PD3). Question numbers are not reused.

| # | Question (why it changes the design) | Recommended default |
|---|---|---|
| Q1a | **Does an operative see their own rate?** (Left over from Q1: PD2 covers companies, not operatives.) | No. Operatives see no rate and no invoice amount other than their own invoice total once created (T-004m scenario 9). |
| Q2 | **Can a level add margin or adjustments, and is there retention?** (PD1 settled that an invoice is own work plus the level below's invoices, and that the rate check warns only.) | Optional manual adjustment lines (description, amount, + or -) added by the issuing company; no automatic margin, margin is an adjustment line. Work done by a company's own employed staff is billed as own lines; work done by invoicing children only through their invoices (never both). Retention (money held back, commonly 3 to 5%) is **not** in this epic. |
| Q3 | **Over-allocation:** may a manager allocate 1,100 m out of 1,000 m, or less than the whole? | Over-allocation blocked with a clear message. Under-allocation allowed; "300 m not yet allocated" is shown and the company may keep it for its own staff. |
| Q4 | **Can work be re-assigned?** | Yes for unfinished quantity only: before any work is recorded the whole allocation can move; after, the done part stays with the original assignee and only the remainder moves or is withdrawn. Every move is audited. |
| Q5 | **Who approves each level's invoice, and how are mistakes fixed?** | The direct parent's manager approves a child's invoice; a company issues its own rollup only when all the child invoices it includes are approved. Issued invoices are immutable; correction is a credit note plus a new invoice. |
| Q6 | **UK construction tax, awareness only: VAT domestic reverse charge and CIS.** Under the reverse charge the customer accounts for VAT on many subcontractor invoices; under CIS contractors deduct 20 or 30% from subcontractor payments and report to HMRC. Does the product handle either? | No. All amounts are recorded and shown **excluding VAT**, with a fixed note "VAT not calculated; no CIS deduction applied". No VAT or CIS fields in this epic. Risk flagged: UK contractors must do both outside the product until a later epic. Paul to say whether he needs the reverse-charge wording or a CIS deduction line next. |
| Q7 | **May a person belong to more than one company, or be both manager and operative?** | One person, one company. A person who needs two roles in the same company has one account with both permissions (manager plus operative). Moving a person to another company is "deactivate and add again", with history kept. No company moves. |
| Q8 | **Maximum depth.** | Contractor plus 5 levels below it (6 levels total) as a configurable limit; adding a company beyond it is refused with a message. |
| Q9 | **Units other than metres, and conversion.** | Units are metres, sq m, rooms, hours, items and "whole job". One unit per job, set at the top, inherited by every allocation; no conversion. Quantities to 2 decimal places. |
| Q10 | **What does an operative see?** | Only their own allocation: job description, site address, checklist, customer contact (T-003 Q11), quantity allocated and done, and "Allocated by <their company>". No rates, no companies above theirs, no siblings. |
| Q11 | **How does existing demo data migrate?** | One root company from the current settings (Arbour Services); all 9 existing users become its members; each existing job becomes a root job, unit "whole job", one allocation to its current painter; the 52 existing invoices become level 0. Then T-004e adds a 4-level demo tree for demos only. |
| Q12 | **Do operatives invoice?** Many UK trades are self-employed; some are employed staff and are paid by their company. | A company flags each operative as "invoices" or "employed". Only "invoices" operatives get an operative-level invoice; employed operatives' work is claimed by the company's own lines. |
| Q13 | **May an operative record partial progress (60 of 100 m), or only done/not done?** | Partial: the operative enters quantity done up to the allocation and may finish with "Mark complete". Done quantity can be corrected upward or downward by the operative until their invoice is created; after that only by manager adjustment. |
| Q14 | **Who creates companies and people, given no email/invitations?** (Revised for PD3.) | A company's Admin or managers create companies and people in their own subtree. The root company, its first Admin and first manager come from the seed or a command line (as today). The creator sets a temporary password, shown once, which the new person must change at first sign-in (this pulls a minimal password change forward from B13). |
| Q16 | **May one person hold both Admin and manager, and does an Admin who is not a manager see report photos, text and customer contacts?** | Yes, one person may hold both (a sole trader needs to). Admin alone never sees photos, report text or customer contacts, as under T-002 D2. |
| Q17 | **May an Admin approve or issue invoices?** | No. Admin is read only on invoices; managers approve and issue. |
| Q18 | **Does the customer-facing invoice show each subcontractor's name and amount, or only job-level lines and the total?** (PD2 says A groups its B's into one report to charge the customer, but does not say what the customer sees.) | The customer sees job-level lines and the total only. A's internal "Subcontractor roll-up" report shows each B's invoice and work summary. No subcontractor name or amount goes to the customer. |

Note: the earlier question "does the Contractor see everything below it?" is answered by PD2 and
PD3. Yes for progress (units, whole subtree); for money only its direct subcontractors' invoices
and rates.
