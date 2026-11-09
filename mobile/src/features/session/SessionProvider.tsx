import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { SessionManager, SessionState } from "../../api/sessionManager";

interface SessionContextValue {
  manager: SessionManager | undefined;
  state: SessionState;
}

const NO_SESSION: SessionState = { status: "signed_out", ready: true, user: undefined };
const noop = () => () => undefined;

const SessionContext = createContext<SessionManager | undefined>(undefined);

/** Makes the SessionManager's state available to screens and re-renders them when it changes. */
export function SessionProvider({ manager, children }: { manager: SessionManager; children: ReactNode }) {
  return <SessionContext.Provider value={manager}>{children}</SessionContext.Provider>;
}

/** Without a provider (shell tests) the user is signed out. */
export function useSession(): SessionContextValue {
  const manager = useContext(SessionContext);
  const state = useSyncExternalStore(manager?.subscribe ?? noop, manager?.getSnapshot ?? (() => NO_SESSION));
  return { manager, state };
}
