import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApiClient } from "@jobproof/shared";
import { App } from "./app/App";
import { readRuntimeConfig } from "./config";
import "./styles/app.css";

const root = createRoot(document.getElementById("root")!);

try {
  configureApiClient({ baseUrl: readRuntimeConfig().apiBaseUrl });
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <main className="page">
      <section className="card" role="alert">
        <h1>JobProof</h1>
        <p className="status status-error">Configuration error</p>
        <p className="muted">{error instanceof Error ? error.message : String(error)}</p>
      </section>
    </main>,
  );
}
