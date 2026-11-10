import { useState } from "react";
import { createQueryClient } from "../src/api/queryClient";
import { getSessionManager } from "../src/api/session";
import { setupApi } from "../src/api/setup";
import { getLocalStore } from "../src/db/openStore";
import { AppRoot } from "../src/features/session/AppRoot";

const manager = getSessionManager();
setupApi(manager);
const store = getLocalStore();

export default function RootLayout() {
  const [client] = useState(createQueryClient);
  return <AppRoot manager={manager} client={client} store={store} />;
}
