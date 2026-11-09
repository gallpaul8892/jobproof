import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppBranding } from "../../theme/BrandingProvider";

/** Neutral heading while the company name is unknown (T-003a scenario 3). */
export const NEUTRAL_HEADING = "Sign in";

/** Company name in white on the theme's primary colour. */
export function AppHeader() {
  const { companyName, theme } = useAppBranding();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { backgroundColor: theme.primary, paddingTop: insets.top + 16 }]} testID="app-header">
      <Text accessibilityRole="header" style={[styles.title, { color: theme.onPrimary }]} testID="app-header-title">
        {companyName ?? NEUTRAL_HEADING}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 22, fontWeight: "700" },
});
