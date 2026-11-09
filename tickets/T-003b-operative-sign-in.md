# T-003b: Operative sign-in, secure session and sign-out

**Persona:** Operative
**Depends on:** T-003a
**Part of:** [T-003](T-003-operative-app.md) (decisions P7, Q1, Q13)

## Context
Dan Hughes signs in once and expects to stay signed in on his own phone for his working days.
Only operatives may use the app: managers and admins have their own web app. The session must
survive app restarts and a flat battery, and end the moment the office deactivates the account.

## Scenarios

### 1. Successful sign-in
Given the demo operative painter@jobproof.test / Painter123! (Dan Hughes)
When Dan enters the email and password and taps "Sign in"
Then he lands on "My jobs" and the header shows "Dan Hughes"

### 2. Wrong password
Given Dan's email and the password "wrong"
When he taps "Sign in"
Then he sees "Email or password is incorrect." and stays on sign-in, with the email kept and the
password cleared

### 3. Manager or admin account
Given manager@jobproof.test or admin@jobproof.test
When they sign in on the app
Then they see "This app is for operatives. Managers use the web app." and no session is kept

### 4. Empty fields
Given both fields are empty
When "Sign in" is tapped
Then each field shows "Enter your email." and "Enter your password." and no request is sent

### 5. Session survives restart
Given Dan is signed in
When the app is force-closed and the phone restarted and the app reopened
Then Dan is still signed in and sees "My jobs" without typing anything

### 6. Token stored securely
Given Dan is signed in
Then the session credential is held in the Android secure store, is not written to app logs, and
is excluded from cloud backup (NFR-10)

### 7. Show password and password manager
Given the password field
When Dan taps "Show" the password is visible, and the field accepts a password-manager autofill

### 8. Sign-out with nothing waiting
Given Dan has no unsent photos or reports
When he taps "Sign out" and confirms
Then he returns to sign-in and the app holds no jobs or customer data

### 9. Sign-out with unsent items
Given Dan has 4 photos not yet uploaded
When he taps "Sign out"
Then he sees "4 photos haven't reached the office yet. Stay signed in so they can send." with
"Stay signed in" (default) and "Sign out anyway"
And "Sign out anyway" keeps the 4 photos on the phone under Dan's account until he signs in again

### 10. Another operative on the same phone
Given Dan signed out with 4 unsent photos and Priya Shah signs in on that phone
Then Priya sees only her own jobs and none of Dan's photos, and Dan's 4 photos remain until Dan signs in

### 11. Account deactivated
Given Dan is signed in and the office deactivates his account
When the app next contacts the server
Then Dan is returned to sign-in with "Your account is no longer active. Contact the office." and
his unsent photos stay on the phone, never deleted automatically

### 12. No signal at sign-in
Given no network
When Dan taps "Sign in"
Then he sees "No signal. Sign in needs a connection." (an already signed-in Dan is unaffected: T-003i)

## Out of scope
Password change or reset (backlog B13), biometric unlock, registration, "remember me" toggle,
multiple accounts at once.

## Open questions
- Session length: default 30 days per device (Q1); the architect decides the mechanism.
- Shared phones: not supported in the pilot (Q13).
