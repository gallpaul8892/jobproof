import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Unreachable } from "./Unreachable";
import { useAppStatus } from "@jobproof/shared";

/**
 * Shows the "Can't reach the office system" screen when the status call fails, with Retry.
 * The branding header stays above it, so the screen is never blank. Once signed-in work exists
 * (T-003b onwards) offline use must not be blocked here: later tickets bypass this gate then.
 */
export function ReachabilityGate({ children }: { children: ReactNode }) {
  const status = useAppStatus();
  const { theme } = useAppBranding();
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
