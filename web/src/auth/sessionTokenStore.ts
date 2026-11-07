import type { TokenStore } from "@jobproof/shared";

const KEY = "jobproof.token";

/** Web TokenStore: sessionStorage, so the token dies with the tab. Falls back to memory. */
export function createSessionTokenStore(storage?: Storage): TokenStore {
  let memory: string | null = null;
  const area = (): Storage | null => {
    try {
      return storage ?? window.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    get() {
      try {
        return area()?.getItem(KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    set(token) {
      memory = token;
      try {
        area()?.setItem(KEY, token);
      } catch {
        /* storage blocked: the in-memory copy keeps this tab signed in */
      }
    },
    clear() {
      memory = null;
      try {
        area()?.removeItem(KEY);
      } catch {
        /* nothing to clear */
      }
    },
  };
}

export const tokenStore = createSessionTokenStore();

/** Synchronous read for route guards (the web store is never async). */
export function currentToken(): string | null {
  const t = tokenStore.get();
  return typeof t === "string" && t !== "" ? t : null;
}
