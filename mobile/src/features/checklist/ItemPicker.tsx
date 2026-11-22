import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import type { OperativeChecklistItem } from "@jobproof/shared";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Button } from "../../ui/Button";
import { SCRIM } from "../../ui/colours";
import { CHECKLIST_MSG } from "./messages";

/** "Move photo to another item": the job's items (and "No item"), in a dialog that scrolls with large text. */
export function ItemPicker({
  visible,
  items,
  currentItemId,
  onPick,
  onCancel,
}: {
  visible: boolean;
  items: OperativeChecklistItem[];
  currentItemId: string | null;
  onPick: (itemId: string | null) => void;
  onCancel: () => void;
}) {
  const { theme } = useAppBranding();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} accessibilityViewIsModal>
      <View style={[styles.scrim, { backgroundColor: SCRIM }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, { backgroundColor: theme.background }]} testID="item-picker" accessibilityViewIsModal>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              {CHECKLIST_MSG.moveTitle}
            </Text>
            {items
              .filter((i) => i.id !== currentItemId && !i.removed)
              .map((i) => (
                <Button key={i.id} label={i.label} variant="secondary" onPress={() => onPick(i.id)} testID={`item-picker-${i.id}`} />
              ))}
            {currentItemId !== null ? <Button label={CHECKLIST_MSG.moveNone} variant="secondary" onPress={() => onPick(null)} testID="item-picker-none" /> : null}
            <Button label="Cancel" onPress={onCancel} testID="item-picker-cancel" />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "center" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  card: { borderRadius: 12, padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
});
