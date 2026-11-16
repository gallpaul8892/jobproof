import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignInScreen as RealSignInScreen } from "../../src/features/session/SignInScreen";
import { DIVIDER, MUTED_TEXT } from "../../src/ui/colours";
import { useAppBranding } from "../../src/theme/BrandingProvider";
import data from "../mock/operativeData.json";
import { loginsOf, type OperativeMockData } from "../mock/data";
import { fillSignIn } from "../frame";

const LOGINS = loginsOf(data as unknown as OperativeMockData);

/**
 * The demo's SignInScreen (browser demo only; metro.config.js swaps this module in for app/sign-in.tsx's
 * import of the real one, so it exports the same name). The real screen with the demo accounts below its form, laid out like the manager web
 * app's login page ("Demo accounts": role, name, email, password and a "Use" button per account).
 */
export function SignInScreen() {
  return <RealSignInScreen footer={<DemoAccounts />} />;
}

export function DemoAccounts({ logins = LOGINS }: { logins?: readonly { name: string; email: string; password: string }[] }) {
  const { theme } = useAppBranding();
  if (logins.length === 0) return null;
  return (
    <View testID="demo-accounts" accessibilityLabel="Demo accounts" style={[styles.section, { borderTopColor: DIVIDER }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Demo accounts
      </Text>
      <Text style={[styles.hint, { color: MUTED_TEXT }]}>Local demo data only. Pick one to fill in the form.</Text>
      <View style={styles.list}>
        {logins.map((login, i) => (
          <View key={login.email} testID={`demo-account-${i}`} style={[styles.card, { backgroundColor: theme.surface, borderColor: DIVIDER }]}>
            <View style={styles.details}>
              <Text style={[styles.role, { color: theme.accent }]}>Operative</Text>
              <Text style={[styles.name, { color: theme.text }]}>{login.name}</Text>
              <Text style={[styles.mono, { color: theme.text }]}>{login.email}</Text>
              <Text style={[styles.mono, { color: theme.text }]}>{login.password}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use operative account, ${login.name}`}
              testID={`demo-use-account-${i}`}
              onPress={() => fillSignIn(login)}
              style={({ pressed }) => [styles.use, { borderColor: theme.primary, backgroundColor: theme.background, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.useText, { color: theme.primary }]}>Use</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, paddingTop: 16, marginTop: 4, gap: 8 },
  heading: { fontSize: 20, fontWeight: "700" },
  hint: { fontSize: 14, lineHeight: 20, },
  list: { gap: 8, marginTop: 4 },
  card: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderRadius: 8, padding: 12 },
  details: { flex: 1, gap: 2 },
  role: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  name: { fontSize: 16, fontWeight: "700" },
  mono: { fontSize: 14, fontFamily: "monospace" },
  use: { minHeight: 44, minWidth: 64, paddingHorizontal: 16, borderWidth: 2, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  useText: { fontSize: 16, fontWeight: "700" },
});
