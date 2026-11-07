# T-001: Manager can view jobs, evidence and billing (mock data)

**Persona:** Manager (head office)

## Context
Painters finish jobs and submit completion reports with photos. Today those arrive in Google
Forms and the office collates them by hand. The manager needs one place to see reported jobs,
check the photo evidence, and see what has been billed and paid, so billing the customer is
quick and defensible. Phase 1 is **read-only with mock data**: no uploads, no editing, no Stripe,
no mobile app. The painter and customer personas are out of scope, but the data model should
not block them later.

## Mock data (seeded, deterministic)
About 12 customers (UK homeowners and a few landlords/small businesses), 6 painters, 60 jobs
over the last 6 months across types (interior repaint, exterior repaint, wallpapering, kitchen
cabinet spray, staircase and woodwork, commercial unit), with UK addresses and GBP amounts.
Each completed job has one completion report with 4 to 10 generated placeholder photos
(before, during, after, with timestamps and captions) and a work checklist. Quotes with deposits
exist for some jobs; invoices exist for most completed jobs in states draft, sent, paid and
overdue; some reports are still awaiting review. Include a few edge cases: a report with no
photos, a job with a long address and notes, a part-paid invoice, a customer with several jobs.
One seeded manager account (credentials shown on the dev login page) and one painter account to
prove role separation.

## Scenarios

### 1. Sign in as manager
Given a seeded manager account
When the manager submits the correct email and password on the login page
Then they land on the dashboard and see their name in the header

### 2. Bad credentials are rejected
Given the login page
When someone submits a wrong password
Then they see a clear error and stay on the login page

### 3. Only managers can use manager data
Given a signed-in painter account (or no token)
When it calls any manager API endpoint
Then the API returns 403 (or 401 with no token) and the web app never shows manager pages

### 4. Dashboard summary
Given the seeded data
When the manager opens the dashboard
Then they see: reports awaiting review, jobs completed this month, total invoiced this month,
total outstanding, and count of overdue invoices, plus the 5 most recent reports. Figures match
the seed data

### 5. List job reports
Given 60 seeded jobs with reports
When the manager opens Reports
Then they see a paginated table (newest first) with job reference, customer, site address,
painter, completion date, photo count, and billing status

### 6. Filter and search reports
Given the reports list
When the manager filters by status, painter or date range, or searches by customer, address or
job reference
Then the table shows only matching rows with the total count, and an empty state when none match

### 7. View evidence for a report
Given a report in the list
When the manager opens it
Then they see job details, painter notes, work checklist, customer details, a photo gallery
(before/during/after with timestamps and captions, enlargeable), and the linked quote, deposit,
invoice and payment status

### 8. Billing overview
Given invoices in several states
When the manager opens Billing
Then they see a paginated table of invoices (customer, job, amount, paid, due date, status),
filterable by status, each linking to its report

### 9. Resilient states
Given the API is slow, empty or failing
When the manager uses any page
Then they see loading, empty and error states with a retry action, never a blank page

### 10. Runs locally, offline
Given Docker is installed and there is no internet
When a developer runs `make up`
Then the whole stack starts with seeded data and the manager can complete scenarios 1 to 9 at
the printed URLs

## Out of scope
Creating or editing anything, painter app and uploads, customer payment links, Stripe, email,
real identity providers, AWS deployment, mobile.

## Open questions
None. The architect should take sensible defaults and record them as assumptions.
