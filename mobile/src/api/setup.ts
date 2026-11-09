import { configureApiClient } from "@jobproof/shared";
import { readConfig } from "../config";

let configured = false;

/** Wires the shared generated client to the configured server. Idempotent. Sign-in (T-003b) adds the token store and refresh hook. */
export function setupApi(baseUrl: string = readConfig().apiBaseUrl): void {
  if (configured) return;
  configureApiClient({ baseUrl });
  configured = true;
}
