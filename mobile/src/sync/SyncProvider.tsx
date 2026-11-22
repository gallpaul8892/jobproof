import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys, type OperativeJob, type OperativeJobList } from "@jobproof/shared";
import type { LocalStore } from "../db/localStore";
import { useSession } from "../features/session/SessionProvider";
import { SyncEngine, httpDraftApi, type DraftApi, type SyncSnapshot } from "./engine";

const SyncContext = createContext<SyncEngine | undefined>(undefined);

/** Puts the server's answer to a save into the query cache (detail and list), which the phone persists for offline use. */
export function cacheSavedJob(client: QueryClient, job: OperativeJob): void {
  client.setQueryData(queryKeys.operativeJob(job.id), job);
  client.setQueryData<OperativeJobList | undefined>(queryKeys.operativeJobs, (list) =>
    list && {
      ...list,
      jobs_today: list.jobs_today.map((j) => (j.id === job.id ? job : j)),
      earlier_unfinished: list.earlier_unfinished.map((j) => (j.id === job.id ? job : j)),
    },
  );
}

/**
 * Creates the sync engine for the app run and runs its triggers: a signed-in user (app start or
 * signing in again), the app coming to the foreground, local edits (inside the engine), backoff
 * timers (inside the engine) and Sync now (the status line). A reconnect trigger needs a network
 * monitor the app does not have yet (see the T-003f report), so recovery after losing signal
 * relies on the backoff timers and the foreground trigger.
 */
export function SyncProvider({ store, client, api = httpDraftApi, children }: { store: LocalStore | undefined; client: QueryClient; api?: DraftApi; children: ReactNode }) {
  const { manager, state } = useSession();
  const engine = useMemo(
    () =>
      store && manager
        ? new SyncEngine({
            drafts: store.drafts,
            api,
            currentUserId: () => {
              const s = manager.getSnapshot();
              return s.status === "signed_in" ? s.user?.id : undefined;
            },
            subscribeLocal: store.subscribe,
            onSaved: (job) => cacheSavedJob(client, job),
          })
        : undefined,
    [store, manager, client, api],
  );

  useEffect(() => {
    engine?.start();
    return () => engine?.dispose();
  }, [engine]);

  const userId = state.status === "signed_in" ? state.user?.id : undefined;
  useEffect(() => {
    if (userId) void engine?.trigger("start");
  }, [engine, userId]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void engine?.trigger("foreground");
    });
    return () => sub.remove();
  }, [engine]);

  return <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>;
}

/** Undefined when no engine is provided (a screen test that does not need one). */
export function useSyncEngine(): SyncEngine | undefined {
  return useContext(SyncContext);
}

const NO_SUBSCRIBE = () => () => undefined;
const EMPTY: SyncSnapshot = { running: false, reports: 0, photos: 0, attention: 0, paused: undefined, waiting: undefined };

export function useSyncStatus(): SyncSnapshot {
  const engine = useSyncEngine();
  return useSyncExternalStore(engine?.subscribe ?? NO_SUBSCRIBE, engine?.getSnapshot ?? (() => EMPTY));
}
