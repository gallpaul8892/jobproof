import data from "./mock/operativeData.json";
import { OperativeBackend } from "./mock/backend";
import { type OperativeMockData } from "./mock/data";
import { createDemoFetch } from "./mock/fetch";
import { installFrame } from "./frame";

/**
 * Entry point of the browser demo. Only demo/shims/openStore.ts imports this, and that file is
 * swapped in by metro.config.js only for `expo export --platform web` with JOBPROOF_DEMO=1, so
 * the Android app and normal web builds contain none of it (mobile/demo/checkDemoBundle.mjs
 * proves it by looking for this marker).
 */
export const DEMO_MARKER = "__JOBPROOF_MOBILE_DEMO__";

let installed = false;

/** `home` is where "Back to all demos" leads (the landing page); the build passes it in. */
export function installDemo(env: { home?: string } = {}): OperativeBackend | undefined {
  if (installed || typeof window === "undefined") return undefined;
  installed = true;
  const backend = new OperativeBackend(data as unknown as OperativeMockData);
  const real = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
  globalThis.fetch = createDemoFetch(backend, real);
  (window as unknown as Record<string, unknown>)[DEMO_MARKER] = true;
  document.title = "JobProof operative app (demo)";
  installFrame(env.home && env.home !== "" ? env.home : "/");
  return backend;
}
