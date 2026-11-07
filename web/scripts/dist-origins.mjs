// Finds external origins in a built dist/. Only XML/SVG namespace URIs are allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ALLOWED = [
  // XML/SVG/MathML namespace identifiers (never fetched).
  /^http:\/\/www\.w3\.org\/.*$/,
  // Dummy base used by react-router when it parses relative URLs (never fetched).
  /^http:\/\/localhost$/,
  // Documentation links inside React / React Router production error strings (never fetched).
  /^https:\/\/(react\.dev|reactrouter\.com)\/.*$/,
];

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
      if (!ALLOWED.some((re) => re.test(m[0]))) found.push({ file, url: m[0] });
    }
  }
  return found;
}
