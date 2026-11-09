import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useAppBranding } from "../../theme/BrandingProvider";
import { useSession } from "./SessionProvider";

/**
 * Route guard. Signed-in users reach the `(app)` group; everyone else reaches sign-in only, so a
 * deep link or a back press cannot show a signed-in screen. A spinner covers the moment before
 * secure storage has been read, so a signed-in operative never sees sign-in flash by.
 */
export function RootNavigator() {
  const { state } = useSession();
  const { theme } = useAppBranding();
  if (!state.ready) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]} testID="session-loading">
        <ActivityIndicator accessibilityLabel="Loading" color={theme.primary} size="large" />
      </View>
    );
  }
  const signedIn = state.status === "signed_in";
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center" } });
