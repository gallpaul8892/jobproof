import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { findExternalOrigins } from "./dist-origins.mjs";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!existsSync(dist)) {
  console.error("check-dist: web/dist does not exist; run vite build first");
  process.exit(1);
}
const found = findExternalOrigins(dist);
if (found.length > 0) {
  for (const f of found) console.error(`external origin in ${f.file}: ${f.url}`);
  console.error("check-dist FAILED: the bundle must not reference external origins");
  process.exit(1);
}
console.log("check-dist OK: no external origins in web/dist");
