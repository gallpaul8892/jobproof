import { useState } from "react";
import { Slot } from "expo-router";
import { createQueryClient } from "../src/api/queryClient";
import { setupApi } from "../src/api/setup";
import { AppShell } from "../src/features/shell/AppShell";

setupApi();

export default function RootLayout() {
  const [client] = useState(createQueryClient);
  return (
    <AppShell client={client}>
      <Slot />
    </AppShell>
  );
}
