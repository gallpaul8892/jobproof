/** Wording from tickets/T-003b-operative-sign-in.md. Changing a string here changes the tests on purpose. */
export const MSG = {
  enterEmail: "Enter your email.",
  enterPassword: "Enter your password.",
  invalidCredentials: "Email or password is incorrect.",
  operativesOnly: "This app is for operatives. Managers use the web app.",
  noSignal: "No signal. Sign in needs a connection.",
  rateLimited: "Too many sign-in attempts. Wait a few minutes and try again.",
  updateRequired: "This version of the app is out of date. Update the app, then sign in.",
  unexpected: "Sign in did not work. Try again.",
  accountInactive: "Your account is no longer active. Contact the office.",
  sessionEnded: "Your session has ended. Sign in again.",
} as const;
