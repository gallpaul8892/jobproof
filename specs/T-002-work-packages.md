# T-002 work packages (build plan for the engineers)

Epic: [tickets/T-002-admin-branding-review-workflow.md](../tickets/T-002-admin-branding-review-workflow.md).
Contract: [api/openapi.yaml](../api/openapi.yaml) v0.2.0 (already contains every T-002 change
except T-002m's, which is a delta inside [T-002m.md](T-002m.md)). Architecture:
[ARCHITECTURE.md](../ARCHITECTURE.md) section 16 (decisions D1 to D7).

Three packages, built **in order**. Inside a package, build the tickets in the order listed.
Each ticket is done (tests green, review APPROVE) before the next starts.

| # | Package | Tickets, in order | Alembic revisions |
|---|---|---|---|
| 1 | Branding and Admin | T-002a, T-002b, T-002c, T-002d, T-002e | 0002 company_settings, 0003 admin role |
| 2 | Review, edit, audit | T-002k, T-002g, T-002h, T-002f, T-002i, T-002j | 0004 report versioning, 0005 audit_events, 0006 manager_notes |
| 3 | Neutral wording, tree-surgery data | T-002l, T-002m (optional) | 0007 job_types (T-002m only) |

Order inside package 2 differs from the epic's numbering on purpose: T-002f (audit) depends on
T-002g (review writes the first event) and must exist before T-002i (edit writes events).

## Contract staging (applies to every package)

The contract already describes the end state. To keep the backend contract tests green while
it is built ticket by ticket, `backend/tests/contract.py` (changed once, in T-002a) gains:

- `PENDING_TICKETS: set[str]`, initially
  `{"T-002b","T-002c","T-002e","T-002f","T-002g","T-002i","T-002k"}` (T-002a removes itself).
- `load_spec()` returns the spec with every operation, parameter and schema property whose
  `x-ticket` is in `PENDING_TICKETS` removed (properties are also removed from `required`).
  `contract_operations()` therefore excludes pending operations; `NOT_YET_IMPLEMENTED` stays
  for anything else and stays empty.
- Each ticket's last step: delete its id from `PENDING_TICKETS`. After T-002i the set is empty.
  Keep the mechanism (it is how later epics stage contracts).

The generated client (`shared/src/generated/`) is regenerated **once at the start of T-002a**
(`npm run gen`) and committed; it then already has every T-002 type and SDK function. If a
typed web test fixture fails to compile because of new required fields (`version`,
`review_queue`...), add the fields to the fixture in that same commit. Nothing else in
`shared/` or `web/` needs to change ahead of its ticket.

## Files touched per package

"New" = created by the package. "Edit" = existing file. Files listed under more than one
package are the only shared seams; every such edit is additive (new keys, new routes, new
exports) so a later package rebases trivially, but the packages are meant to run in sequence.

### Package 1 (T-002a to T-002e)

Backend
- New: `backend/app/branding/__init__.py`, `defaults.py`, `contrast.py`;
  `backend/app/models/settings.py`; `backend/app/schemas/settings.py`;
  `backend/app/services/settings.py`; `backend/app/routers/branding.py`, `admin.py`;
  `backend/app/cli.py`; `backend/migrations/versions/0002_company_settings.py`,
  `0003_admin_role.py`.
- Edit: `backend/app/models/__init__.py`, `models/enums.py` (admin), `main.py` (two routers),
  `errors.py` (`errors`/`extensions` on `ProblemError`), `seed/catalogue.py` (2 users, demo
  accounts), `seed/loader.py` (skip `company_settings`), `.env.example` (commented
  `DEFAULT_COMPANY_NAME`). `config.py` is **not** changed: `DEFAULT_COMPANY_NAME` is read by
  migration 0002 only. `schemas/auth.py` already types role as `UserRole`, so admin flows
  through.
- Tests new: `test_branding_api.py`, `test_company_settings_model.py`,
  `test_no_hardcoded_branding.py`, `test_admin_access.py`, `test_admin_settings_api.py`,
  `test_contrast.py`, `test_cli_create_admin.py`. Edit: `contract.py`, `test_seed.py`,
  `test_dataset.py`, `dataset_checks.py`, `expected.py`, `test_manager_access.py`
  (admin token), `test_auth_api.py` (demo accounts), `conftest.py` (`admin_headers`,
  `manager2_headers`, `restore_settings` fixture).

Shared
- New: `shared/src/branding/defaults.ts`, `presets.ts`, `contrast.ts`, `companyName.ts`,
  `index.ts`, `branding.test.ts`; `shared/src/hooks/useBranding.ts`, `useAdmin.ts`.
- Edit: `shared/src/index.ts` (exports), `shared/src/api/queryKeys.ts` (`branding`,
  `adminSettings`), `shared/src/api/errors.ts` (`ApiError.problem`, ratio fields; T-002e),
  `shared/src/format/labels.ts` (`roleLabel`; T-002b), `shared/src/generated/*` (regenerated once).

Web
- New: `web/src/theme/applyTheme.ts`, `brandingCache.ts`, `BrandingProvider.tsx`,
  `theme.test.ts`; `web/src/pages/Settings.tsx`, `web/src/pages/settings/CompanyNameForm.tsx`,
  `ColourSchemeForm.tsx`, `ThemePreview.tsx`; `web/src/app/roles.ts`.
- Edit: `web/index.html` (title, favicon), `web/public/favicon.svg` (deleted), `web/src/main.tsx`,
  `web/src/app/App.tsx`, `router.tsx`, `guards.tsx`, `Shell.tsx`, `web/src/components/ui.tsx`
  (`useDocumentTitle`), `web/src/pages/Login.tsx` (heading, title, post-login landing),
  `NotAuthorised.tsx` (per-role text), `web/src/styles/app.css` (tokens, header, buttons),
  `web/scripts/check-dist.mjs` only if a new external string appears (none expected).

E2E
- New: `e2e/tests/admin.spec.ts`, `branding.spec.ts`, `theme.spec.ts`, `a11y.spec.ts`,
  `e2e/tests/global-setup.ts` (restore default settings). Edit: `e2e/playwright.config.ts`
  (globalSetup), `e2e/tests/support.ts` (admin and manager2 sign-in helpers),
  `e2e/package.json` (`@axe-core/playwright` 4.14.0), `auth.spec.ts`, `layout.spec.ts`,
  `screenshots.spec.ts` (title and brand text changes).

### Package 2 (T-002k, g, h, f, i, j)

Backend
- New: `backend/app/models/audit.py`; `backend/app/services/audit.py`, `review.py`,
  `report_edit.py`; `backend/app/schemas/audit.py`, `report_write.py`;
  `backend/migrations/versions/0004_report_versioning.py`, `0005_audit_events.py`,
  `0006_manager_notes.py`.
- Edit: `backend/app/models/work.py` (JobReport columns), `models/enums.py` (AuditAction,
  AuditEntity), `models/__init__.py`, `routers/manager.py` (sort, review, PATCH, history),
  `routers/admin.py` (settings history route only), `services/reports.py` (sort, queue,
  detail fields), `services/dashboard.py` (queue), `services/settings.py` (write the
  `settings.changed` event), `schemas/manager.py`, `seed/loader.py` (audit truncate guard),
  `seed/dataset.py` (manager_notes None).
- Tests new: `test_review_queue_api.py`, `test_review_api.py`, `test_audit_store.py`,
  `test_report_history_api.py`, `test_settings_history_api.py`, `test_report_edit_api.py`,
  `test_concurrency.py`. Edit: `contract.py` (PENDING_TICKETS), `conftest.py` (`reseed`
  fixture, defined in T-002k), `test_performance_logging.py` (new endpoints in the bound check).

Shared
- New: `shared/src/hooks/useReportWrites.ts`, `shared/src/history.ts` (event sentences),
  `shared/src/conflict.ts`, tests beside them.
- Edit: `shared/src/filters.ts` (`sort`), `shared/src/api/queryKeys.ts` (`reportHistory`),
  `shared/src/hooks/useManager.ts` (`useReports` passes sort), `shared/src/format/dates.ts`
  (`waitingLabel`), `shared/src/index.ts`.

Web
- New: `web/src/pages/dashboard/ReviewQueue.tsx`, `web/src/pages/report/ReviewPanel.tsx`,
  `HistoryPanel.tsx`, `EditReportForm.tsx`, `useUnsavedChangesGuard.ts`.
- Edit: `web/src/pages/Dashboard.tsx`, `Reports.tsx` (sort param), `ReportDetail.tsx`,
  `web/src/styles/app.css` (append a "review/edit/history" block only).

E2E
- New: `e2e/tests/review-queue.spec.ts`, `review.spec.ts`, `history.spec.ts`,
  `edit-report.spec.ts`. Edit: `support.ts` (reseed helper), `report-detail.spec.ts`.

### Package 3 (T-002l, T-002m)

- T-002l edits only: `shared/src/format/labels.ts` (role and field-worker labels),
  `web/src/pages/*.tsx` text, `web/src/app/Shell.tsx` text, e2e text expectations; new
  `web/src/wording.test.ts`. No backend, contract or generated-client change.
- T-002m: see [T-002m.md](T-002m.md) (contract delta, migration 0007, seed profile files).
</content>
</invoke>
