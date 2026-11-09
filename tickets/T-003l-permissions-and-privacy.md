# T-003l: Camera and location permissions, and privacy

**Persona:** Operative; Customer (whose home is photographed)
**Depends on:** T-003e
**Part of:** [T-003](T-003-operative-app.md) (P4, P6, Q12, NFR-10)

## Context
The app photographs the insides of people's homes. The operative must understand why the app
asks for camera and location, can say no without being stuck, and the company must be able to say
honestly what the app collects. UK GDPR applies: customers did not install the app but their homes
and sometimes their belongings, documents or family appear in photos.

## Scenarios

### 1. Camera: explain before asking
Given Dan taps "Take photo" for the first time
Then he first sees "This app needs your camera to photograph your work for the office" with "Continue",
and only after that the Android system camera prompt appears

### 2. Camera allowed
Given he allows it
Then the camera opens at once and is not asked again

### 3. Camera denied once
Given he taps "Don't allow"
Then he sees "Without the camera you can only add photos from your gallery." with "Choose from gallery"
and "Try again"; the rest of the job still works

### 4. Camera permanently denied
Given he denied twice (Android stops prompting)
When he taps "Take photo"
Then he sees "Camera is turned off for this app" with an "Open settings" button that opens the app's
phone settings page, and on return the camera works without restarting

### 5. Location: optional and explained
Given Dan takes his first photo
Then after the camera permission he sees "Add location to your photos? It shows the office where the
photo was taken. You can change this any time." with "Allow while using the app" and "Not now"
And "Not now" never blocks capture and the question is not asked again for 7 days unless he opens Settings

### 6. Location only while in use
Given location is allowed
Then it is requested only at the moment of taking a photo, never in the background, and the app has no
background location permission (NFR-6)

### 7. Change later
Given Settings in the app
Then Dan can see "Camera: allowed", "Location: allowed/not allowed" and tap through to the phone settings

### 8. Gallery without broad permission
Given Dan picks from the gallery
Then the app uses the system photo picker and does not request access to all photos or files

### 9. Privacy notice in the app
Given Settings > "Privacy"
Then it states in plain English what is collected (photos, time, optional location, notes, sign-in
details), who sees it (the company's office staff), that photos are not saved to the phone's gallery or
shared with anyone else, and shows a contact for questions; the same text is the Play Store privacy policy (T-003p)

### 10. Nothing sensitive leaks
Given the app running
Then no photo, customer name, address or token appears in logs, crash reports, analytics or
notifications, and the app screen is hidden in the phone's recent-apps preview (Android secure flag)

### 11. Not in backups
Given the phone's Google backup is on
Then the app's local photos, queue and session are excluded from backup (NFR-10)

### 12. Customer-visible information
Given a customer asks "what do you do with these photos?"
Then Dan can show the in-app privacy notice, and the manager's side holds the retention answer (Q12, a decision for Paul before launch)

### 13. Accounts and screen lock
Given the phone has no screen lock
Then the app still works but Settings shows "Your phone has no screen lock. Customer photos on it are less protected." (informational)

## Out of scope
iOS permission copy, consent management for customers, automated retention or deletion of server
photos, data-subject request tooling, device encryption enforcement, MDM.

## Open questions
- Retention: how long does the company keep photos? Default: to be set by Paul before launch (Q12).
- Does "JobProof" appear in permission text? Default: use the company name when branding is loaded, else "this app".
