import type { SessionManager } from "./sessionManager";

/** The session hooks for the shared client: in-memory access token, one shared refresh, sign-out on loss. */
export function sessionApiOptions(manager: SessionManager) {
  return { tokenStore: manager.accessTokenStore, refresh: manager.refresh, onUnauthorized: manager.handleUnauthorized };
}
