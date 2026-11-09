import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@jobproof/shared";
import { clearPersistedQueries } from "../../api/queryPersister";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { useSession } from "./SessionProvider";
import { unsentMessage, unsentTotal, useUnsentItems, type UnsentSummary } from "./unsent";

type Step = { kind: "idle" } | { kind: "confirm" } | { kind: "unsent"; summary: UnsentSummary };

/**
 * Sign-out (T-003b scenarios 8 to 10). Nothing waiting: confirm, then end the session. Something
 * waiting: the default is "Stay signed in"; "Sign out anyway" keeps every row and file under the
 * user id (this component deletes none), and only the credentials and the cached server data go.
 */
export function SignOutControl() {
  const { manager, state } = useSession();
  const unsent = useUnsentItems();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  async function begin() {
    if (!state.user) return;
    let summary: UnsentSummary;
    try {
      summary = await unsent.summaryFor(state.user.id);
    } catch {
      // If the count cannot be read, assume work may be waiting: ask rather than risk it.
      summary = { photos: 0, reports: 1 };
    }
    setStep(unsentTotal(summary) > 0 ? { kind: "unsent", summary } : { kind: "confirm" });
  }

  async function signOut() {
    if (busy || !manager) return;
    setBusy(true);
    setStep({ kind: "idle" });
    const userId = state.user?.id;
    try {
      await manager.signOut();
      // Cached server answers belong to the user who has left. Branding and status are public.
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== queryKeys.branding[0] && q.queryKey[0] !== queryKeys.appStatus[0],
      });
      // After the in-memory clear, so a pending save cannot bring the stored copy back.
      if (userId) clearPersistedQueries(userId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button label="Sign out" onPress={() => void begin()} testID="sign-out" variant="secondary" disabled={busy} />
      <ConfirmDialog
        testID="sign-out-confirm"
        visible={step.kind === "confirm"}
        title="Sign out?"
        message="You have nothing waiting to send."
        actions={[
          { label: "Cancel", onPress: () => setStep({ kind: "idle" }), testID: "sign-out-cancel", isDefault: true },
          { label: "Sign out", onPress: () => void signOut(), testID: "sign-out-confirm-yes" },
        ]}
      />
      <ConfirmDialog
        testID="sign-out-unsent"
        visible={step.kind === "unsent"}
        title="Not everything has been sent"
        message={step.kind === "unsent" ? unsentMessage(step.summary) : ""}
        actions={[
          { label: "Stay signed in", onPress: () => setStep({ kind: "idle" }), testID: "sign-out-stay", isDefault: true },
          { label: "Sign out anyway", onPress: () => void signOut(), testID: "sign-out-anyway" },
        ]}
      />
    </>
  );
}
