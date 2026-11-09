import { Pressable, StyleSheet, Text } from "react-native";
import { useAppBranding } from "../theme/BrandingProvider";

/** Action button: 56 dp tall for gloved, on-site use (design 3.1 `ui/`). `secondary` is outlined. */
export function Button({
  label,
  onPress,
  testID,
  disabled = false,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const { theme } = useAppBranding();
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: theme.primary } : { borderColor: theme.primary, borderWidth: 2, backgroundColor: theme.background },
        { opacity: disabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.label, { color: primary ? theme.onPrimary : theme.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 56, minWidth: 160, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 8 },
  label: { fontSize: 18, fontWeight: "600", textAlign: "center" },
});
