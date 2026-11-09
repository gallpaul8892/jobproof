import { ApiError } from "@jobproof/shared";
import { MSG } from "./messages";

export interface SignInFailure {
  message: string;
  /** Wrong password and 403 clear the password and keep the email. */
  clearPassword: boolean;
}

/** Maps a failed createDeviceSession call to what the operative reads. */
export function mapSignInError(error: unknown): SignInFailure {
  if (error instanceof ApiError) {
    if (error.status === 401 && error.code === "invalid_credentials") return { message: MSG.invalidCredentials, clearPassword: true };
    if (error.status === 403 && error.code === "operatives_only") return { message: MSG.operativesOnly, clearPassword: true };
    if (error.status === 0) return { message: MSG.noSignal, clearPassword: false }; // network_error or timeout
    // The WAF answers a rate-limited sign-in with a bare 403; the API itself may use 429.
    if (error.status === 429 || error.status === 403) return { message: MSG.rateLimited, clearPassword: false };
    if (error.status === 426) return { message: MSG.updateRequired, clearPassword: false };
  }
  return { message: MSG.unexpected, clearPassword: false };
}
