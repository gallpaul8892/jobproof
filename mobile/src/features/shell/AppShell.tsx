import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrandingProvider, useAppBranding } from "../../theme/BrandingProvider";
import { AppHeader } from "./AppHeader";
import { ReachabilityGate } from "./ReachabilityGate";

function Frame({ children }: { children: ReactNode }) {
  const { theme } = useAppBranding();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="light" />
      <AppHeader />
      <ReachabilityGate>{children}</ReachabilityGate>
    </View>
  );
}

/** Providers, branded header and the reachability gate around the current route. */
export function AppShell({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={client}>
        <BrandingProvider>
          <Frame>{children}</Frame>
        </BrandingProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
