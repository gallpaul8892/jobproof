import { StyleSheet, Text, View } from "react-native";
import { useAppBranding } from "../../theme/BrandingProvider";
import { useSession } from "./SessionProvider";

/** The signed-in operative's full name under the company header. */
export function UserBar() {
  const { theme } = useAppBranding();
  const { state } = useSession();
  return (
    <View style={[styles.bar, { backgroundColor: theme.surface }]}>
      <Text style={[styles.name, { color: theme.text }]} testID="user-name" accessibilityLabel={state.user ? `Signed in as ${state.user.full_name}` : undefined}>
        {state.user?.full_name ?? ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 20, paddingVertical: 10 },
  name: { fontSize: 18, fontWeight: "600" },
});
