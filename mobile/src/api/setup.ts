import { configureApiClient } from "@jobproof/shared";
import { readConfig } from "../config";
import { sessionApiOptions } from "./sessionClient";
import type { SessionManager } from "./sessionManager";

let configured = false;

/**
 * Wires the shared generated client to the configured server and, once a SessionManager is given,
 * to the session: access token from memory, one shared refresh on 401, and the unauthorized
 * hook. Idempotent.
 */
export function setupApi(manager?: SessionManager, baseUrl: string = readConfig().apiBaseUrl): void {
  if (configured) return;
  configureApiClient({
    baseUrl,
    ...(manager ? sessionApiOptions(manager) : {}),
  });
  configured = true;
}

/** For tests: allow setupApi to run again. */
export function resetApiSetupForTests(): void {
  configured = false;
}
