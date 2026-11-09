import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { SCRIM } from "./colours";
import { useAppBranding } from "../theme/BrandingProvider";

export interface DialogAction {
  label: string;
  onPress: () => void;
  testID: string;
  /** The safe choice; drawn first and as the primary button. */
  isDefault?: boolean;
}

/**
 * In-app dialog (not Alert) so wording, order and the safe default are testable and large text
 * scrolls instead of clipping. Actions stack vertically with the default first.
 */
export function ConfirmDialog({ visible, title, message, actions, testID }: { visible: boolean; title: string; message: string; actions: DialogAction[]; testID: string }) {
  const { theme } = useAppBranding();
  const ordered = [...actions].sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => ordered[0]?.onPress()} accessibilityViewIsModal>
      <View style={[styles.scrim, { backgroundColor: SCRIM }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, { backgroundColor: theme.background }]} testID={testID} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              {title}
            </Text>
            <Text style={[styles.message, { color: theme.text }]} testID={`${testID}-message`}>
              {message}
            </Text>
            {ordered.map((a) => (
              <Button key={a.testID} label={a.label} onPress={a.onPress} testID={a.testID} variant={a.isDefault ? "primary" : "secondary"} />
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "center" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  card: { borderRadius: 12, padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  message: { fontSize: 18, lineHeight: 26 },
});
