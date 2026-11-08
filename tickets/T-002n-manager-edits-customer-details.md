# T-002n: Manager corrects a customer's details (audited)

**Persona:** Manager
**Owner:** backend-engineer (API, migration), then frontend-engineer (customer page); architect
updated the contract first; test-engineer for e2e
**Depends on:** T-002f (audit trail), T-002i/T-002j (edit and conflict conventions)
**Part of:** [T-002](T-002-admin-branding-review-workflow.md), Package 4. Decision by Paul,
2026-11-08 (amends D4: customer contact details become editable).
**Spec:** [specs/T-002n.md](../specs/T-002n.md)

## Context
Customer details are typed in once and then appear on every job, report and invoice for that
customer. When something is wrong (a misspelt name, an old phone number, a billing address that
has changed) the manager must be able to correct it, and because the reports and invoices are
billing evidence, every correction must be recorded: who, when, old value, new value. A customer
is shared by all of their jobs, so the manager is told how many jobs and reports a change affects
before saving. Only contact details are editable: ids, the customer type, payment terms, and job,
photo and checklist data are not. Managers do this; Admins (who may be technical staff, not
managers) cannot see or change customers.

## Scenarios

### 1. Open the customer page from a report
Given a report for customer "Harbourside Lettings Ltd"
When the manager clicks the customer name in the report's Customer section
Then the customer page shows name, type Landlord, contact Marcus Ellery, email, phone, billing
address "Unit 4, Welsh Back Court, Bristol, City of Bristol, BS1 4SB", the customer's reports
(12) and a History section

### 2. Correct the phone number
Given Harbourside Lettings Ltd at version 1 with phone "07700 900201"
When Sarah Whitfield clicks "Edit details", changes the phone to "0117 496 0123" and saves
Then she sees "Changes saved", the page shows the new phone, version is 2, and History has an
entry "Sarah Whitfield changed customer details: Phone" with before "07700 900201" and after
"0117 496 0123"

### 3. Impact is shown before saving
Given Harbourside Lettings Ltd has 12 jobs, 12 reports of which 9 are reviewed, and 7 issued
invoices (seeded counts; tests read them from the dataset, not from this text)
When the manager is in edit mode
Then a notice says "These details are used on 12 jobs, 12 reports (9 reviewed) and 7 issued
invoices. Changes will show on all of them. Reviewed reports stay reviewed."
And counts of one are singular ("1 job, 1 report"), and a part with zero is left out ("no issued
invoices" is not mentioned)

### 4. The change shows on every affected report's history, without reopening it
Given a reviewed Harbourside Lettings Ltd report (reviewed by Sarah Whitfield)
When Priya Nair corrects the customer's email
Then that report is still Reviewed by Sarah, its version is unchanged, and its History shows "Priya
Nair changed customer details: Email" with old and new values
And every other Harbourside report shows the same entry in its History
And the report's Customer section shows the new email

### 5. Postcode, phone and email are tolerant but checked
Given the edit form
When the manager enters postcode "bs1 4sb", phone "+44 (0)117 496 0123" and email
" accounts@harbourside.example.co.uk "
Then the save succeeds and the stored values are "BS1 4SB", "+44 (0)117 496 0123" and
"accounts@harbourside.example.co.uk"
And postcode "BS1", phone "12345" or email "accounts at harbourside" are refused with a message
beside the field ("Enter a UK postcode such as BS6 5QA.", "Enter a UK phone number such as 07700
900123, or an international number starting with +.", "Enter an email address such as
name@example.co.uk.") and nothing is saved

### 6. Blank optional fields become empty, required fields cannot be blank
Given the edit form
When the manager clears contact name, email, phone, address line 2 or county
Then it is saved as empty (null) and shown as "-"
And clearing the name, address line 1, town or postcode is refused ("Enter a name." etc.)

### 7. Length and character rules
Given the edit form
When the name is longer than 120 characters, an address line longer than 100, the town or
county longer than 60, the email longer than 254, the phone longer than 30, or any field contains
a control character (including NUL, tab or a line break), a zero-width or bidi formatting
character, or an invalid (lone surrogate) character
Then the API returns 422 `validation_error` with an `errors` entry per problem and nothing is
saved, and the web form shows the limit or "Remove control characters." beside the field (the
same character rule as the company name)

### 8. Only contact details are editable
When the PATCH body contains `id`, `customer_type`, `payment_terms_days`, `notes`, `job_count`,
`impact`, a job, report, photo or checklist field, or an unknown key
Then the API returns 422 naming the key and changes nothing

### 9. No-op saves change nothing
Given the body repeats the current values (including "bs1 4sb" when "BS1 4SB" is stored)
When it is sent with the current version
Then the response is 200 with the same version and no history entry is written

### 10. Two managers editing the same customer
Given Sarah and Priya both loaded Harbourside Lettings Ltd at version 2
When Sarah saves a phone change (version 3) and Priya then saves an email change with version 2
Then Priya gets 409 `version_conflict` with the current version, "Sarah Whitfield" and the time,
and the current value of the email; nothing of Priya's is saved and no event is written
And the web page shows "Sarah Whitfield changed this customer at 11:40. Your changes were not
saved.", keeps Priya's typed values, shows the current saved email beside the field and offers
"Reload latest" (and, after T-002o, "Apply my changes on top")
And two simultaneous saves with the same version give exactly one 200 and one 409

### 11. Who can do it
Given the customer endpoints and the customer page
When called with no token, a painter token or an admin token
Then they return 401, 403 and 403, an unknown customer id 404 and a non-uuid id 422
And an admin or painter visiting `/customers/<id>` sees the not-authorised page

### 12. Failure keeps work and text is shown safely
Given the save fails with 500 or the network drops
Then "Try again" appears, the typed values stay, and a successful retry writes one history entry
And a name like `<b>Smith</b> & "Sons"` is shown literally everywhere it appears

### 13. Contract
Then the operations and fields are in `api/openapi.yaml` (marked `x-ticket: T-002n`), T-002n is
removed from `PENDING_TICKETS`, route parity and `assert_contract` pass, the generated client is
regenerated and committed, and re-seeding is identical (every customer at version 1, no events)

## Out of scope
Creating, merging or deleting customers; changing customer type, payment terms or internal notes;
a customers list or search page; job site addresses (job data); snapshotting the billing address
onto invoices (needed before invoice documents or Stripe, flagged); revert from history.

## Open questions (defaults applied)
- Should customer type be editable too? Default: **no** (it is classification, not contact data).
- Should an edit that affects several jobs need an extra confirmation dialog? Default: **no**, the
  impact notice is always visible in edit mode next to Save.
- Should issued invoices keep the address they were issued with? Default: they show the current
  address today (no snapshot exists); snapshot at issue when invoice documents/Stripe arrive.
- Should the email be lower-cased? Default: **no**, stored as entered (trimmed).
- Non-UK postcodes? Default: refused (customers and sites are in the UK).
</content>
