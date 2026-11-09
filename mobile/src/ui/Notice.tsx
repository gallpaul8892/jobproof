import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { ERROR_BG, ERROR_COLOUR, NOTICE_BG, NOTICE_TEXT } from "./colours";

/** A banner above content: "Offline. ..." (amber) or an error (red) with an optional Retry. Announced when it appears. */
export function Notice({
  kind,
  message,
  onRetry,
  testID,
}: {
  kind: "offline" | "error";
  message: string;
  onRetry?: () => void;
  testID?: string;
}) {
  const error = kind === "error";
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.box, { backgroundColor: error ? ERROR_BG : NOTICE_BG, borderColor: error ? ERROR_COLOUR : NOTICE_TEXT }]}
      testID={testID}
    >
      <Text style={[styles.text, { color: error ? ERROR_COLOUR : NOTICE_TEXT }]} testID={testID ? `${testID}-text` : undefined}>
        {message}
      </Text>
      {onRetry ? <Button label="Retry" onPress={onRetry} variant="secondary" testID={testID ? `${testID}-retry` : undefined} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 10 },
  text: { fontSize: 16, fontWeight: "600" },
});
