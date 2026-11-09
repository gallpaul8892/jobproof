import { ScrollView, StyleSheet, Text } from "react-native";
import { useAppBranding } from "../../theme/BrandingProvider";
import { SignOutControl } from "./SignOutControl";
import { useSession } from "./SessionProvider";

export function SettingsScreen() {
  const { theme } = useAppBranding();
  const { state } = useSession();
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.body} testID="settings-screen">
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
        Settings
      </Text>
      {state.user ? <Text style={[styles.line, { color: theme.text }]}>{state.user.email}</Text> : null}
      <SignOutControl />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 24, gap: 20 },
  title: { fontSize: 24, fontWeight: "700" },
  line: { fontSize: 18 },
});
