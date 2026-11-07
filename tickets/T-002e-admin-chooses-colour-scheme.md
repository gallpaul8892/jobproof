# T-002e: Admin chooses the colour scheme (with WCAG AA validation)

**Persona:** Admin
**Owners:** backend-engineer (validation, PATCH), frontend-engineer (picker, live preview)
**Depends on:** T-002c, T-002d
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decision D6

## Context
The Admin can replace the default dark green with the company's own colours. A scheme is two
colours, **primary** (header, buttons, carrying white text) and **accent** (links, focus ring on
white). Everything else (white background, surface, text) stays fixed so the app remains readable.
Rule: **each of primary and accent must have at least 4.5:1 contrast against white (WCAG 2.2 AA
for normal text); anything lower is rejected** by the server, and the page explains why before the
Admin presses Save. The same rule is enforced on the server whatever the client does.

Examples for tests (ratio against white): `#1F5130` 9.22, `#2F5D3A` 7.64, `#1F3A5F` 11.48,
`#7A1F2B` 10.20, `#767676` 4.54 (accepted, boundary), `#777777` 4.48 (rejected, boundary),
`#4CAF50` 2.78 (rejected), `#FFD400` 1.43 (rejected).

## Scenarios

### 1. Choose a preset
Given the admin is on `/settings`
When he picks the preset "Navy" (primary `#1F3A5F`, accent `#2B4C7E`) and saves
Then `GET /api/v1/branding` returns those colours and a reload shows a navy header, navy buttons
and navy links for every persona
And the presets are Forest (the default), Navy, Charcoal (`#2B2B2B`, `#444444`) and Burgundy
(`#7A1F2B`, `#8A2433`), each verified AA in a unit test

### 2. Custom colours
Given the Settings page
When the admin enters primary `#1F3A5F` and accent `#767676`
Then it saves, because both reach 4.5:1

### 3. Low contrast is rejected by the server
Given the admin submits primary `#4CAF50` (2.78:1)
When `PATCH /api/v1/admin/settings` is called
Then it returns 422 `contrast_too_low` with an `errors` entry for `theme.primary` giving the
measured ratio (2.78) and the required ratio (4.5), and the stored theme is unchanged
And `#777777` (4.48:1) is also rejected and `#767676` (4.54:1) accepted

### 4. The page shows the problem before saving
Given the admin types `#FFD400` into the primary field
Then the preview shows the measured ratio "1.43:1, needs 4.5:1" as an error beside the field,
Save is disabled, and the live preview keeps showing the last valid scheme

### 5. Invalid input
Given the API
When primary is `green`, `#12345`, `#GGGGGG`, `1F5130` or missing while a theme is supplied
Then it returns 422 `validation_error`, and `#1f5130` (lower case) is accepted and stored as
`#1F5130`

### 6. Live preview and reset
Given the admin changes a colour
Then a preview panel (sample header, button, link) updates immediately without saving
And "Reset to default" restores Forest (`#1F5130`, `#2F5D3A`) after confirming, and saving it
returns branding to the default theme

### 7. The scheme applies to every page and persona
Given the Navy scheme is saved
When a manager and a painter (who sees the not-authorised page) load the app
Then header, buttons, links and focus ring use Navy and the automated contrast check from T-002d
still reports zero violations

### 8. Only the Admin can change it
Given a manager token, a painter token and no token
When each calls `PATCH /api/v1/admin/settings` with a theme
Then they get 403, 403 and 401, and the theme is unchanged

### 9. Name and colours are saved independently
Given the admin changes only the colours
Then the company name is unchanged, and changing only the name leaves the colours unchanged

## Out of scope
Changing background, surface or text colours, per-page themes, dark mode, logo, scheduled
themes, a warning-only mode (low contrast is always rejected).

## Open questions
- Reject versus warn: Paul said "reject or warn"; the default here is **reject**, since an
  unreadable header locks everyone out of reading the app. Admin could not undo it from a broken
  page without the Reset button, which is therefore always reachable.
