# T-003a: App shell, build and company branding

**Persona:** Operative (and the team: this is the foundation slice)
**Depends on:** T-002a (branding endpoint), existing `shared/` client
**Part of:** [T-003](T-003-operative-app.md)

## Context
Before an operative can do anything, there must be an installable Android app that talks to the
same API as the web app, uses the same generated client, and shows the company's own name and
colours. This is the thin vertical slice that proves the toolchain and gives every later ticket
somewhere to land.

## Scenarios

### 1. Install and open
Given a debug or preview Android build and the local stack running (`make up`)
When the app is installed on an Android 10 or later phone or emulator and opened
Then it shows a sign-in placeholder screen with no crash, within 4 s of tapping the icon

### 2. Company name and colours
Given the Admin has set the company name to "Arbour Services" and the default dark green theme
When the app opens with signal
Then the header shows "Arbour Services" in the theme's primary colour with white text
And changing the colour in Admin settings and reopening the app shows the new colour

### 3. Branding with no signal on first ever launch
Given a freshly installed app and no network
When it opens
Then it shows the default theme and a neutral heading "Sign in" (no company name), not an error screen

### 4. Branding remembered
Given the app has loaded branding once
When it opens later with no network
Then it shows the last company name and colours

### 5. Shared client, one source of truth
Given `api/openapi.yaml`
When the generated client is regenerated
Then the mobile app builds against the same generated package as the web app, and a stale
client fails the existing `gen:check`

### 6. Server address is configuration
Given a build configured for a server address
When the build is made for local, dev and production
Then each talks only to its configured address and no address or secret is committed to git

### 7. Wrong or unreachable server
Given the server is not reachable
When the app opens
Then the user sees "Can't reach the office system. Check your signal and try again." with a Retry
button, not a blank screen

### 8. Industry-neutral wording
Given any screen in this ticket
Then it uses "Operative" and never "painter" (NFR-11)

## Out of scope
Sign-in itself (T-003b), iOS build, Play Store (T-003p), app icon and splash beyond a plain
placeholder using the company name.

## Open questions
- App name on the phone: default "JobProof" (working name) until Paul chooses.
