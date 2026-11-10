import { useSession } from "../session/SessionProvider";

/** The signed-in operative's id: every local query is filtered by it. */
export function useOwnerId(): string | undefined {
  return useSession().state.user?.id;
}
