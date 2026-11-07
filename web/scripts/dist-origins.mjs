// Finds external origins in a built dist/. Only the exact strings in ALLOWED are permitted.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Exact string equality only (specs/T-000-bootstrap.md section 7.1); no patterns or prefixes.
export const ALLOWED = new Set([
  // XML/SVG/MathML namespace identifiers (never fetched).
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/XML/1998/namespace",
  // Dummy base used by react-router when it parses relative URLs (never fetched).
  "http://localhost",
  // Text of React / React Router production error and warning messages (never fetched).
  "https://react.dev/errors/",
  "https://reactrouter.com/en/main/routers/picking-a-router.",
]);

const TEXT_EXT = /\.(html|js|mjs|css|svg|json|map|txt|webmanifest)$/i;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Returns [{file, url}] for every disallowed http(s) URL found under dir. */
export function findExternalOrigins(dir) {
  const found = [];
  for (const file of walk(dir)) {
    if (!TEXT_EXT.test(file)) continue;
    // config.js is the runtime config (generated per environment); it holds the API origin.
    if (file === join(dir, "config.js")) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
      if (!ALLOWED.has(m[0])) found.push({ file, url: m[0] });
    }
  }
  return found;
}
