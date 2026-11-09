import Storage from "expo-sqlite/kv-store";
import type { User } from "@jobproof/shared";
import type { UserCache } from "./sessionManager";

export const USER_KEY = "jobproof.session.user.v1";

function isUser(v: unknown): v is User {
  if (typeof v !== "object" || v === null) return false;
  const u = v as Record<string, unknown>;
  return typeof u.id === "string" && typeof u.full_name === "string" && typeof u.email === "string" && typeof u.role === "string";
}

/** The signed-in user's name for the header while offline. Cleared on sign-out. Holds no credential. */
export const kvUserCache: UserCache = {
  read() {
    try {
      const raw = Storage.getItemSync(USER_KEY);
      if (raw === null) return undefined;
      const parsed: unknown = JSON.parse(raw);
      if (isUser(parsed)) return parsed;
      Storage.removeItemSync(USER_KEY);
    } catch {
      /* corrupt or unavailable: no cached user */
    }
    return undefined;
  },
  write(user) {
    try {
      Storage.setItemSync(USER_KEY, JSON.stringify(user));
    } catch {
      /* the app works without it */
    }
  },
  clear() {
    try {
      Storage.removeItemSync(USER_KEY);
    } catch {
      /* ignore */
    }
  },
};
