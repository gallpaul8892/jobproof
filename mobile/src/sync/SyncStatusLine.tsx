import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppBranding } from "../theme/BrandingProvider";
import { useSession } from "../features/session/SessionProvider";
import { syncStatusLine } from "./engine";
import { useSyncEngine, useSyncStatus } from "./SyncProvider";

/**
 * The header's one-line sync status (design 3.4): "All sent", "Sending 1 report", "Waiting for
 * signal (1 report)", "Needs attention (1)". Shown only while signed in. When something is
 * waiting it offers Sync now, which ignores any backoff.
 */
export function SyncStatusLine() {
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const { state } = useSession();
  const { theme } = useAppBranding();
  if (!engine || state.status !== "signed_in") return null;
  const text = syncStatusLine(status);
  const idle = text === "All sent";
  return (
    <View style={styles.row} testID="sync-status" accessible={false}>
      <Text style={[styles.text, { color: theme.onPrimary }]} testID="sync-status-text" accessibilityLabel={`Sync status: ${text}`}>
        {text}
      </Text>
      {!idle && !status.running && status.paused !== "update_required" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sync now"
          onPress={() => void engine.syncNow()}
          style={[styles.button, { borderColor: theme.onPrimary }]}
          testID="sync-now"
        >
          <Text style={[styles.buttonText, { color: theme.onPrimary }]}>Sync now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 4 },
  text: { fontSize: 16, flexShrink: 1 },
  button: { minHeight: 48, minWidth: 48, borderWidth: 2, borderRadius: 8, paddingHorizontal: 12, justifyContent: "center" },
  buttonText: { fontSize: 16, fontWeight: "700" },
});
