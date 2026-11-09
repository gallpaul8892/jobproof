import { StyleSheet, Text, View } from "react-native";
import { operativeJobStatusLabel, operativeStatusIcon, type OperativeJob } from "@jobproof/shared";
import { useAppBranding } from "../theme/BrandingProvider";
import { MUTED_TEXT } from "./colours";

type Badged = Pick<OperativeJob, "status" | "checklist_dealt_with" | "checklist_total">;

/** Status as an icon plus words, never colour alone. The icon is decoration for screen readers. */
export function StatusBadge({ job, muted = false, testID }: { job: Badged; muted?: boolean; testID?: string }) {
  const { theme } = useAppBranding();
  const colour = muted ? MUTED_TEXT : theme.text;
  return (
    <View style={styles.row} testID={testID}>
      <Text style={[styles.icon, { color: colour }]} importantForAccessibility="no" accessibilityElementsHidden>
        {operativeStatusIcon(job)}
      </Text>
      <Text style={[styles.word, { color: colour }]} testID={testID ? `${testID}-text` : undefined}>
        {operativeJobStatusLabel(job)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  icon: { fontSize: 16, fontWeight: "700" },
  word: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
});
