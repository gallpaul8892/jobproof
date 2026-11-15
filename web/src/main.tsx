import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { configureApiClient } from "@jobproof/shared";
import { App } from "./app/App";
import { queryClient } from "./app/queryClient";
import { router } from "./app/router";
import { currentToken, tokenStore } from "./auth/sessionTokenStore";
import { loginUrl } from "./auth/redirect";
import { readRuntimeConfig } from "./config";
import { DEFAULT_THEME } from "@jobproof/shared";
import { applyTheme } from "./theme/applyTheme";
import { readSnapshot } from "./theme/brandingCache";
import "./styles/app.css";

const root = createRoot(document.getElementById("root")!);

/** A 401 mid-session: forget the token and the cached data, then go to the login page. */
function handleUnauthorized() {
  if (currentToken() === null) return; // already signed out; avoids a redirect loop
  void tokenStore.clear();
  queryClient.clear();
  const { pathname, search } = router.state.location;
  void router.navigate(loginUrl(pathname + search, true), { replace: true });
}

// Theme the page before the first render, so the first paint already has the right colours.
applyTheme(readSnapshot()?.theme ?? DEFAULT_THEME);

try {
  // GitHub Pages demo (`vite build --mode pages`): answer the API in the browser. The check is
  // on the build mode, which Vite replaces with a constant, so a normal build drops the branch
  // and the dynamic import with it: none of the mock code or data reaches a production bundle.
  let mockFetch: typeof fetch | undefined;
  let banner: ReactNode = null;
  if (import.meta.env.MODE === "pages") {
    const mock = await import("./mock");
    mockFetch = mock.installMockApi().fetch;
    banner = <mock.DemoBanner />;
  }
  configureApiClient({
    baseUrl: readRuntimeConfig().apiBaseUrl,
    tokenStore,
    onUnauthorized: handleUnauthorized,
    fetch: mockFetch,
  });
  root.render(
    <StrictMode>
      <App />
      {banner}
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <main className="fullpage">
      <section className="panel narrow" role="alert">
        <h1>Configuration error</h1>
        <p className="muted">{error instanceof Error ? error.message : String(error)}</p>
      </section>
    </main>,
  );
}
