import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createUserPersister, PERSIST_BUSTER, PERSIST_MAX_AGE_MS, shouldPersistQuery } from "../../api/queryPersister";
import { useSession } from "../session/SessionProvider";

/** Whose operative data the in-memory cache of each client currently holds. */
const owners = new WeakMap<QueryClient, string>();

/**
 * Restores the signed-in operative's job list and details from the phone's store (so the app
 * opens with yesterday's list when there is no signal) and keeps them saved. Lives inside the
 * signed-in route group, so it exists only while a user is signed in.
 */
export function PersistedQueries({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { state } = useSession();
  const userId = state.user?.id;

  // If another operative's data is still in memory (session ended, someone else signed in), drop
  // it before anything restores or renders. Idempotent, so safe to run twice.
  useState(() => {
    if (userId && owners.get(client) !== userId) {
      client.removeQueries({ queryKey: ["operative"] });
      owners.set(client, userId);
    }
  });

  const persister = useMemo(() => (userId ? createUserPersister(userId) : undefined), [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") persister?.flush();
    });
    return () => {
      sub.remove();
      persister?.flush();
    };
  }, [persister]);

  if (!persister) return <>{children}</>;
  return (
    <PersistQueryClientProvider
      key={userId}
      client={client}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE_MS,
        buster: PERSIST_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
