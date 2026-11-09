import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useAppBranding } from "../../theme/BrandingProvider";

/** Stands in for the job list until T-003c. */
export function MyJobsPlaceholder() {
  const { theme } = useAppBranding();
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.body} testID="my-jobs-screen">
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
        My jobs
      </Text>
      <Text style={[styles.line, { color: theme.text }]}>Your jobs will appear here.</Text>
      <Link href="/settings" accessibilityRole="link" style={[styles.link, { color: theme.primary }]} testID="open-settings">
        Settings
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: "700" },
  line: { fontSize: 18 },
  link: { fontSize: 18, fontWeight: "700", paddingVertical: 12 },
});
