import { configureApiClient } from "@jobproof/shared";
import type { QueryClient } from "@tanstack/react-query";
import { renderRouter } from "expo-router/testing-library";
import { createQueryClient } from "../src/api/queryClient";
import { SecureTokenStore } from "../src/api/secureTokenStore";
import { sessionApiOptions } from "../src/api/sessionClient";
import { SessionManager } from "../src/api/sessionManager";
import { kvUserCache } from "../src/api/userCache";
import { AppRoot } from "../src/features/session/AppRoot";
import type { UnsentItemsSource } from "../src/features/session/unsent";
import type { LocalStore } from "../src/db/localStore";
import { makeTestStore } from "./support/store";
import { deviceSessionApi } from "@jobproof/shared";
import type { fakeServer } from "./fakeServer";

/* eslint-disable @typescript-eslint/no-require-imports */
const SignInRoute = require("../app/sign-in").default;
const AppGroupLayout = require("../app/(app)/_layout").default;
const MyJobsRoute = require("../app/(app)/index").default;
const JobRoute = require("../app/(app)/jobs/[jobId]/index").default;
const SettingsRoute = require("../app/(app)/settings").default;
const CameraRoute = require("../app/(app)/jobs/[jobId]/camera").default;
const PhotoRoute = require("../app/(app)/jobs/[jobId]/photos/[photoId]").default;

export interface Launched {
  manager: SessionManager;
  client: QueryClient;
  server: ReturnType<typeof fakeServer>;
  store: LocalStore;
}

const open: SessionManager[] = [];
const clients: QueryClient[] = [];
export function cleanupLaunched() {
  open.splice(0).forEach((m) => m.dispose());
  clients.splice(0).forEach((c) => c.clear());
}

/** The real route files and the real root wiring, with an in-memory server and the mocked secure store. */
export async function launch(server: ReturnType<typeof fakeServer>, unsent?: UnsentItemsSource, store: LocalStore = makeTestStore().store): Promise<Launched> {
  const manager = new SessionManager({
    secrets: new SecureTokenStore(),
    api: deviceSessionApi,
    userCache: kvUserCache,
    appVersion: "0.1.0",
    deviceName: "Android 14",
  });
  const client = createQueryClient();
  open.push(manager);
  clients.push(client);
  configureApiClient({ baseUrl: "http://api.test", fetch: server.fetch, ...sessionApiOptions(manager) });
  const Root = () => <AppRoot manager={manager} client={client} store={store} unsent={unsent} />;
  await renderRouter(
    {
      _layout: Root,
      "sign-in": SignInRoute,
      "(app)/_layout": AppGroupLayout,
      "(app)/index": MyJobsRoute,
      "(app)/settings": SettingsRoute,
      "(app)/jobs/[jobId]/index": JobRoute,
      "(app)/jobs/[jobId]/camera": CameraRoute,
      "(app)/jobs/[jobId]/photos/[photoId]": PhotoRoute,
    },
    { initialUrl: "/" },
  );
  return { manager, client, server, store };
}
