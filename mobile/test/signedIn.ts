import type { User } from "@jobproof/shared";
import { REFRESH_TOKEN_KEY } from "../src/api/secureTokenStore";
import { USER_KEY } from "../src/api/userCache";
import type { LocalStore } from "../src/db/localStore";
import { launch } from "./harness";
import type { fakeServer } from "./fakeServer";
import { DAN, DEVICE } from "./helpers";

export const secrets = () => (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
export const kv = () => (globalThis as unknown as { __kvStore: Map<string, string> }).__kvStore;

/** Starts the real app as an operative who signed in on an earlier run (token in the secure store, user cached). */
export async function launchSignedIn(server: ReturnType<typeof fakeServer>, user: User = DAN, store?: LocalStore) {
  secrets().set(REFRESH_TOKEN_KEY, server.seedSession(user, DEVICE));
  kv().set(USER_KEY, JSON.stringify(user));
  return launch(server, undefined, store);
}

export const persistedKey = (user: User) => `jobproof.query.v1.${user.id}`;
