# T-003p: Play Store readiness

**Persona:** Operative (receives the app); Paul / the company (publishes it)
**Depends on:** T-003a to T-003n (T-003o optional)
**Part of:** [T-003](T-003-operative-app.md) (P8, Q15, Q16, NFR-6, NFR-9)

## Context
An operative needs to install the app from Google Play without developer tools. The first release
is to a closed or internal testing track for Arbour Services, not a public listing. Publishing
needs a signed build, store listing, privacy policy and data declarations, and proof the NFRs hold
on a real phone.

## Scenarios

### 1. Installable from Play
Given a signed release build uploaded to the internal testing track
When Dan opens the testing link on his Android 10+ phone and installs
Then the app opens to sign-in with the company's default name and theme, no developer menu, no debug banner

### 2. Pointed at production
Given the release build
Then it talks only to the production address (configuration, not code, T-003a scenario 6) and shows no
demo-account list

### 3. Version and update
Given a newer release
Then Play offers the update, and the app's "minimum supported version" check (T-003n scenario 6) works against the new number

### 4. Store listing content
Given the listing
Then it has a name, short and long description in British English, screenshots on a phone (sign-in, jobs, a
job, photo capture) using mock data only, an icon, and a contact email

### 5. Data safety and privacy policy
Given Google Play's data safety form
Then it declares exactly what the app collects (photos, approximate/precise location if allowed, name and email
for the account, notes), states it is encrypted in transit and removable on request, and links to the privacy policy text of T-003l scenario 9

### 6. Permissions declared are only those used
Given the release build
Then it requests only camera, optionally location while in use, network state and the system's notification
permission if needed, and no background location, contacts, SMS or storage-wide permission

### 7. Signing and secrets
Given the repository
Then no signing key, keystore password or API secret is in git, and the build is reproducible from CI with the secrets held outside the repo

### 8. Performance and battery check on a real phone
Given the reference phone (Android 10+, 3 GB RAM)
Then a recorded test shows: cold start under 4 s, camera ready under 2 s, 60 photos in a simulated day within
the NFR-1 size limits, battery use attributable to the app about 15% or less over a working day, and no crash across the full demo script

### 9. Offline test on a real phone
Given airplane mode on a real phone
Then the offline scenarios of T-003i (2, 4, 6, 9) pass as a manual test script signed off by the product owner

### 10. Rollback
Given a faulty release
Then the previous release can be re-promoted on the track within the day, and the minimum-version check
means an older faulty version can be retired without breaking operatives' unsent work

### 11. Support
Given a problem
Then the app shows the operative a short "App version" and "Contact the office" in Settings so a support call can identify the build (no technical logs shown)

## Out of scope
Public listing and store optimisation, iOS App Store, paid app or in-app purchases, crash analytics vendor
choice (the architect decides; it must meet T-003l scenario 10), device farm automation.

## Open questions
- Who owns the Google Play developer account? Default: the company (Arbour Services), with Paul as
  administrator. A one-off Play developer registration is needed (this is Paul's decision and cost).
- Closed testing requirements from Google for new personal developer accounts may force a minimum tester
  period before production; default: an organisation account to avoid it, to be checked by Paul.
