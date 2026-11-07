# T-002d: Default theme applied across the web app

**Persona:** Manager, Admin, Painter (everyone who sees the web app)
**Owner:** frontend-engineer (test-engineer for the contrast checks)
**Depends on:** T-002a, T-002b
**Part of:** [T-002](T-002-admin-branding-review-workflow.md) decision D6

## Context
The web app should look like a formal, modern, minimal business tool in the spirit of Amazon or
eBay but simpler: a dark green header bar, white page, restrained use of one dark green for
buttons and links, plenty of white space, system fonts, no gradients or decoration. (Arbour's own
website is **not** a reference.) The look is driven by one theme object, the default of which is:

| Token | Hex | Used for | Contrast vs white |
|---|---|---|---|
| primary | `#1F5130` | header bar, primary buttons | 9.22:1 |
| accent | `#2F5D3A` | links, active navigation, focus ring | 7.64:1 |
| background | `#FFFFFF` | page | n/a |
| surface | `#F4F7F2` | cards, table stripes | n/a |
| text | `#1B1F1C` | body text (on white 16.68:1, on surface 15.43:1) | |

White text on primary is the header and button text. The theme is fetched from `/api/v1/branding`
(T-002a) and applied at runtime, so T-002e can change it without a rebuild.

## Scenarios

### 1. Default look
Given the seeded app with no settings change
When a manager opens the dashboard
Then the header bar background is `#1F5130` with white text, the page background is `#FFFFFF`,
primary buttons are `#1F5130` with white text, links are `#2F5D3A`, and body text is `#1B1F1C`
(asserted on computed styles in Playwright)

### 2. Login page uses the theme
Given nobody is signed in
When the login page loads
Then it shows the same white page, a `#1F5130` primary "Sign in" button and the dark green focus
ring on the focused field

### 3. One theme object, no stray colours
Given the web source
When a test scans the stylesheet and components
Then the default theme hex codes are defined in exactly one module, styles refer to theme
variables, and no other brand hex codes appear (the fixed status colours for review, billing and
error badges are a separate named set, each meeting 4.5:1 against its badge background)

### 4. Fallback when branding cannot load
Given `/api/v1/branding` fails
When any page loads
Then the app uses the default theme above (not browser defaults) and is fully usable

### 5. Contrast is verified
Given the default theme
When the unit test computes WCAG 2.2 contrast for white-on-primary, accent-on-white,
accent-on-surface, text-on-white and text-on-surface
Then every ratio is at least 4.5:1 and the test fails if the default theme is edited below that
And an automated accessibility check (tool at the test engineer's discretion) reports zero colour
contrast violations on login, dashboard, reports, report detail and billing

### 6. Visible keyboard focus
Given any interactive element
When it receives keyboard focus
Then a focus ring in the accent colour is visible with at least 3:1 contrast against the adjacent
background

### 7. Responsive header
Given a 360px wide viewport
Then the header (company name, navigation, user menu) does not overflow horizontally and every
link is reachable

### 8. The existing CSP still holds
Given the production build served with the generated CSP
When the theme is applied
Then the page renders with the theme and the CSP e2e test still passes (the architect chooses the
mechanism; injected `<style>` blocks would violate the policy)

## Out of scope
Dark mode, logo, fonts other than system fonts, redesign of page layouts or components beyond
colour and spacing, Admin editing (T-002e).

## Open questions
- Does Paul want to approve a screenshot of the default look before T-002e starts? Default: yes,
  the test engineer attaches screenshots to the report; a visual miss does not block merging.
