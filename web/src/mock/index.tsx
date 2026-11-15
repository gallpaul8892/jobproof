import { useEffect } from "react";
import mockData from "./mockData.json";
import { createMockBackend } from "./backend";
import { createMockFetch } from "./handler";
import type { MockData } from "./rawTypes";
import "./demoBanner.css";

/**
 * Entry point of the Pages demo. Only src/main.tsx imports this, behind a `MODE === "pages"`
 * check, so a normal build contains none of it (scripts/check-dist.mjs proves it by looking for
 * this marker and the demo passwords).
 */
export const MOCK_MARKER = "__JOBPROOF_MOCK_API__";
export const DEMO_BANNER_TEXT = "Demo with sample data. Nothing is saved.";

export function installMockApi(): { fetch: typeof fetch; apiBaseUrl: string } {
  const backend = createMockBackend(mockData as unknown as MockData);
  // The generated client needs a base URL to build requests; the mock fetch answers them all
  // in the browser, so nothing is ever sent to it. The page's own origin is used.
  const apiBaseUrl = window.location.origin;
  window.__JOBPROOF_CONFIG__ = { ...window.__JOBPROOF_CONFIG__, apiBaseUrl };
  return { fetch: createMockFetch(backend), apiBaseUrl };
}

export function DemoBanner() {
  useEffect(() => {
    document.body.classList.add("has-demo-banner");
    return () => document.body.classList.remove("has-demo-banner");
  }, []);
  return (
    <div className="demo-banner" role="status" data-testid="demo-banner" data-mock={MOCK_MARKER}>
      <strong>Demo</strong> with sample data. Nothing is saved.
    </div>
  );
}
