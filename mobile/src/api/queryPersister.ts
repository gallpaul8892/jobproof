import Storage from "expo-sqlite/kv-store";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import type { Query } from "@tanstack/react-query";
import { PERSIST_MAX_AGE_MS } from "./persistConfig";

/** One entry per signed-in user: a second operative on the phone never reads the first one's list. */
export const PERSIST_KEY_PREFIX = "jobproof.query.v1.";
export const persistKeyFor = (userId: string): string => `${PERSIST_KEY_PREFIX}${userId}`;

export { PERSIST_MAX_AGE_MS };
/** Bump to discard every stored cache after a shape change. */
export const PERSIST_BUSTER = "1";

/** Only the operative's own server data is stored: never branding, status or anything else. */
export function shouldPersistQuery(query: Pick<Query, "queryKey" | "state">): boolean {
  return query.queryKey[0] === "operative" && query.state.status === "success";
}

export interface KvLike {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): void;
}

export interface UserPersister extends Persister {
  /** Writes any pending change now (called when the app goes to the background). */
  flush(): void;
  /** Sign-out: removes the stored copy and ignores every later save from this instance. */
  discard(): void;
}

/** Live persisters by user, so sign-out can stop a pending write from re-creating the entry. */
const active = new Map<string, UserPersister>();

/**
 * TanStack Query persister over the SQLite key-value store (`expo-sqlite/kv-store`), keyed by user
 * id. Writes are trailing-throttled so a burst of cache updates is one write. A corrupt entry is
 * removed and treated as empty. It holds server data only.
 */
export function createUserPersister(userId: string, options: { storage?: KvLike; throttleMs?: number } = {}): UserPersister {
  const storage = options.storage ?? Storage;
  const throttleMs = options.throttleMs ?? 1000;
  const key = persistKeyFor(userId);
  let pending: PersistedClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let discarded = false;

  function write() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!pending || discarded) return;
    const value = pending;
    pending = undefined;
    try {
      storage.setItemSync(key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable: the app works from the network */
    }
  }

  const persister: UserPersister = {
    persistClient(client) {
      if (discarded) return;
      pending = client;
      if (throttleMs <= 0) return write();
      timer ??= setTimeout(write, throttleMs);
    },
    restoreClient() {
      try {
        const raw = storage.getItemSync(key);
        if (raw === null) return undefined;
        return JSON.parse(raw) as PersistedClient;
      } catch {
        try {
          storage.removeItemSync(key);
        } catch {
          /* ignore */
        }
        return undefined;
      }
    },
    removeClient() {
      pending = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
      try {
        storage.removeItemSync(key);
      } catch {
        /* ignore */
      }
    },
    flush: write,
    discard() {
      discarded = true;
      persister.removeClient();
    },
  };
  active.set(userId, persister);
  return persister;
}

/** Sign-out: the stored copy of this user's server data goes. */
export function clearPersistedQueries(userId: string, storage: KvLike = Storage): void {
  active.get(userId)?.discard();
  active.delete(userId);
  try {
    storage.removeItemSync(persistKeyFor(userId));
  } catch {
    /* ignore */
  }
}
