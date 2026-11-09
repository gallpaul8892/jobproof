import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { SessionManager } from "../../api/sessionManager";
import { AppShell } from "../shell/AppShell";
import { RootNavigator } from "./RootNavigator";
import { SessionProvider } from "./SessionProvider";

/** Everything the root layout renders, with the session manager injected (the layout passes the real one). */
export function AppRoot({ manager, client }: { manager: SessionManager; client: QueryClient }) {
  useEffect(() => {
    void manager.restore();
  }, [manager]);
  return (
    <SessionProvider manager={manager}>
      <AppShell client={client}>
        <RootNavigator />
      </AppShell>
    </SessionProvider>
  );
}
