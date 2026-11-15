import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { findExternalOrigins, findMockCode } from "./dist-origins.mjs";

// `--pages` checks the GitHub Pages demo build (it must contain the mock API); without it the
// build is a real one and must contain none of the mock code or data.
const pages = process.argv.includes("--pages");
// `--dir=<name>`: the output folder under web/ (default `dist`; the pages build uses `dist-pages`).
const dirArg = process.argv.find((a) => a.startsWith("--dir="));
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", dirArg ? dirArg.slice(6) : "dist");
if (!existsSync(dist)) {
  console.error("check-dist: the output folder does not exist; run vite build first");
  process.exit(1);
}
const found = findExternalOrigins(dist);
if (found.length > 0) {
  for (const f of found) console.error(`external origin in ${f.file}: ${f.url}`);
  console.error("check-dist FAILED: the bundle must not reference external origins");
  process.exit(1);
}
const mock = findMockCode(dist);
if (!pages && mock.length > 0) {
  for (const m of mock) console.error(`mock code in ${m.file}: ${m.marker}`);
  console.error("check-dist FAILED: a normal build must not contain the demo's mock API or data");
  process.exit(1);
}
if (pages && mock.length === 0) {
  console.error("check-dist FAILED: the pages build does not contain the mock API");
  process.exit(1);
}
console.log(`check-dist OK: no external origins in ${dist}${pages ? " (pages demo build)" : "; no mock code"}`);
