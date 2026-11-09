import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../ui/Button";
import { TextField, type TextFieldInstance } from "../../ui/TextField";
import { ERROR_COLOUR } from "../../ui/colours";
import { useAppBranding } from "../../theme/BrandingProvider";
import { MSG } from "./messages";
import { mapSignInError } from "./signInErrors";
import { useSession } from "./SessionProvider";

/** Operative sign-in (T-003b). Validation happens on the phone first; no request goes out for an empty field. */
export function SignInScreen() {
  const { theme } = useAppBranding();
  const { manager, state } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextFieldInstance>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A notice from the session itself: the server ended it, or the office deactivated the account.
  const notice = state.status === "inactive" ? MSG.accountInactive : state.status === "needs_sign_in" ? MSG.sessionEnded : undefined;

  async function submit() {
    if (busy || !manager) return;
    const trimmed = email.trim();
    const missingEmail = trimmed.length === 0;
    const missingPassword = password.length === 0;
    setEmailError(missingEmail ? MSG.enterEmail : undefined);
    setPasswordError(missingPassword ? MSG.enterPassword : undefined);
    setFormError(undefined);
    if (missingEmail || missingPassword) return;
    setBusy(true);
    try {
      await manager.signIn(trimmed, password);
    } catch (error) {
      if (!mounted.current) return;
      const failure = mapSignInError(error);
      setFormError(failure.message);
      if (failure.clearPassword) setPassword("");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        testID="sign-in-screen"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Sign in
        </Text>
        {notice ? (
          <View style={[styles.notice, { borderColor: ERROR_COLOUR, backgroundColor: theme.surface }]} testID="session-notice">
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.noticeText, { color: theme.text }]}>
              {notice}
            </Text>
          </View>
        ) : null}
        <TextField
          testID="sign-in-email"
          label="Email"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setEmailError(undefined);
          }}
          error={emailError}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          importantForAutofill="yes"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!busy}
        />
        <TextField
          ref={passwordRef}
          testID="sign-in-password"
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setPasswordError(undefined);
          }}
          error={passwordError}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          importantForAutofill="yes"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!busy}
          labelAction={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              onPress={() => setShowPassword((s) => !s)}
              hitSlop={8}
              testID="sign-in-show-password"
              style={styles.toggle}
            >
              <Text style={[styles.toggleText, { color: theme.primary }]}>{showPassword ? "Hide" : "Show"}</Text>
            </Pressable>
          }
        />
        {formError ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.formError, { color: ERROR_COLOUR }]} testID="sign-in-error">
            {formError}
          </Text>
        ) : null}
        <Button label={busy ? "Signing in" : "Sign in"} onPress={() => void submit()} disabled={busy} testID="sign-in-submit" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: 24, gap: 20, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "700" },
  notice: { borderWidth: 2, borderRadius: 8, padding: 14 },
  noticeText: { fontSize: 18, lineHeight: 26 },
  toggle: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 8 },
  toggleText: { fontSize: 16, fontWeight: "700" },
  formError: { fontSize: 18, fontWeight: "600", lineHeight: 26 },
});
