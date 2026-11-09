import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../ui/Button";
import { useAppBranding } from "../../theme/BrandingProvider";

export const UNREACHABLE_MESSAGE = "Can't reach the office system. Check your signal and try again.";

export function Unreachable({ onRetry }: { onRetry: () => void }) {
  const { theme } = useAppBranding();
  return (
    <View style={[styles.body, { backgroundColor: theme.background }]} testID="unreachable">
      <Text style={[styles.message, { color: theme.text }]} accessibilityRole="alert">
        {UNREACHABLE_MESSAGE}
      </Text>
      <Button label="Retry" onPress={onRetry} testID="unreachable-retry" />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 24 },
  message: { fontSize: 18, textAlign: "center", lineHeight: 26 },
});
