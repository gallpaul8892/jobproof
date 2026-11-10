import { useEffect, type ReactNode } from "react";
import { queryKeys } from "@jobproof/shared";
import type { QueryClient } from "@tanstack/react-query";
import { clearPersistedQueries } from "../../api/queryPersister";
import type { SessionManager } from "../../api/sessionManager";
import { LocalStoreProvider, type LocalStore } from "../../db/localStore";
import { AppShell } from "../shell/AppShell";
import { RootNavigator } from "./RootNavigator";
import { SessionProvider } from "./SessionProvider";
import { UnsentItemsContext, type UnsentItemsSource } from "./unsent";

function WithLocalStore({ store, unsent, children }: { store?: LocalStore; unsent?: UnsentItemsSource; children: ReactNode }) {
  // The sign-out dialog counts what is really on this phone (T-003b scenario 9): the store's source, unless a test injects one.
  const source = unsent ?? store?.unsent;
  const inner = store ? <LocalStoreProvider store={store}>{children}</LocalStoreProvider> : children;
  return source ? <UnsentItemsContext.Provider value={source}>{inner}</UnsentItemsContext.Provider> : inner;
}

/** Everything the root layout renders, with the session manager and the local store injected (the layout passes the real ones). */
export function AppRoot({ manager, client, store, unsent }: { manager: SessionManager; client: QueryClient; store?: LocalStore; unsent?: UnsentItemsSource }) {
  useEffect(() => {
    void manager.restore();
  }, [manager]);

  // Involuntary end (the server ended the session, or the account was deactivated): the customer
  // phone numbers, addresses and notes in the job cache go, in memory and in the saved copy.
  // Unsent photos and drafts live in the local database and are deliberately left alone.
  useEffect(() => {
    let lastUserId = manager.getSnapshot().user?.id;
    return manager.subscribe(() => {
      const { status, user } = manager.getSnapshot();
      if (user) lastUserId = user.id;
      if ((status === "needs_sign_in" || status === "inactive") && lastUserId) {
        clearPersistedQueries(lastUserId);
        client.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.branding[0] && q.queryKey[0] !== queryKeys.appStatus[0] });
        lastUserId = undefined;
      }
    });
  }, [manager, client]);
  return (
    <SessionProvider manager={manager}>
      <WithLocalStore store={store} unsent={unsent}>
        <AppShell client={client}>
          <RootNavigator />
        </AppShell>
      </WithLocalStore>
    </SessionProvider>
  );
}
