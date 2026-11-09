import { Pressable, StyleSheet, Text } from "react-native";
import { useAppBranding } from "../theme/BrandingProvider";

/** Primary action: 56 dp tall for gloved, on-site use (design 3.1 `ui/`). */
export function Button({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const { theme } = useAppBranding();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={[styles.label, { color: theme.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 56, minWidth: 160, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  label: { fontSize: 18, fontWeight: "600" },
});
