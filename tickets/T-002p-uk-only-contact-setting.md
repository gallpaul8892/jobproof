# T-002p: "UK only" customer contact details is an admin setting

**Persona:** Admin (changes it), Manager (is bound by it)
**Owner:** backend-engineer (setting, validation, contract), then frontend-engineer
**Depends on:** T-002b/c/e (admin settings), T-002f (audit), T-002n (customer edits)
**Part of:** [T-002](T-002-admin-branding-review-workflow.md). Decision by Paul, 2026-11-08.
**Spec:** [specs/T-002p.md](../specs/T-002p.md)

## Context
A UK company wants customer postcodes and phone numbers checked as UK ones; a company with
overseas customers needs to turn that off. It is a company setting the Admin owns, not a code
change. It only affects new edits; existing customer data is left alone.

## Scenarios

### 1. Default is UK only
Given a new deployment
When anyone loads the app (branding) or the Admin opens Settings
Then "UK only" is on

### 2. Admin turns it off, with an audit trail
Given UK only is on
When the Admin turns it off and saves
Then the setting reads off for everyone, and the settings History shows "Tom Ashworth changed
settings: UK-only contact details, On to Off"

### 3. Managers cannot change it
Given a Manager or Painter
When they try to change the setting
Then the server refuses (403) and the value is unchanged

### 4. UK only on: UK values only
Given UK only is on
When the Manager saves a phone "+1 202 555 0100" or a postcode "10001"
Then each is refused beside its field ("Enter a UK phone number such as 07700 900123.", "Enter a
UK postcode such as BS6 5QA.") and nothing is saved
And "07700 900123", "+44 7700 900123" and "bs65qa" (stored "BS6 5QA") are accepted

### 5. UK only off: other countries accepted
Given UK only is off
When the Manager saves a phone "+1 202 555 0100" or a postcode "10001" or "k1a 0b1"
Then they are saved (postcode upper case, "K1A 0B1")
And a postcode of "1" or "12.3" is refused with "Enter a postcode." and a phone of "abc" with the
UK-or-international message

### 6. Turning it back on does not rewrite data
Given a customer saved with phone "+1 202 555 0100" while UK only was off, and UK only is now on
When the Manager changes only the customer's name
Then the save succeeds and the phone is unchanged

### 7. Forms follow the setting (frontend)
Given the setting is off
When the Manager edits a customer in the web app
Then the form accepts the same values as the server, with the same messages, without a round trip
