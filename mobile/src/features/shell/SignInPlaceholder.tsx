import { StyleSheet, Text, View } from "react-native";
import { useAppBranding } from "../../theme/BrandingProvider";

/** Placeholder until operative sign-in (T-003b). */
export function SignInPlaceholder() {
  const { theme } = useAppBranding();
  return (
    <View style={[styles.body, { backgroundColor: theme.background }]} testID="sign-in-screen">
      <Text style={[styles.text, { color: theme.text }]}>Sign in for operatives is coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 24, justifyContent: "center" },
  text: { fontSize: 18, textAlign: "center" },
});
