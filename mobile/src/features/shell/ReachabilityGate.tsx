import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Unreachable } from "./Unreachable";
import { useAppStatus } from "@jobproof/shared";
import { useSession } from "../session/SessionProvider";

/**
 * Shows the "Can't reach the office system" screen when the status call fails, with Retry.
 * The branding header stays above it, so the screen is never blank. Once signed-in work exists
 * a signed-in operative is never blocked here (offline use, T-003b scenario 12 / T-003i): the gate
 * only guards the way to the sign-in screen.
 */
export function ReachabilityGate({ children }: { children: ReactNode }) {
  const status = useAppStatus();
  const { theme } = useAppBranding();
  const { state } = useSession();
  if (state.status === "signed_in") return <>{children}</>;
  if (status.isError) {
    return <Unreachable onRetry={() => void status.refetch()} />;
  }
  if (status.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]} testID="status-loading">
        <ActivityIndicator accessibilityLabel="Loading" color={theme.primary} size="large" />
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center" } });
