// Checks a built mobile output folder:
//   node demo/checkDemoBundle.mjs --demo <dir>   the browser demo: must hold the demo, and no external origin
//   node demo/checkDemoBundle.mjs --normal <dir> any other build (Android export, plain web): must hold none of it
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Strings that only the demo contains (demo/install.ts, demo/frame.ts, the placeholder server address in app.config.ts).
export const DEMO_MARKERS = ["__JOBPROOF_MOBILE_DEMO__", "demo.invalid", "Demo with sample data. Nothing is saved.", "Demo image drawn in your browser"];

// Exact strings only: namespaces and text of library error messages. None is ever fetched.
export const ALLOWED_ORIGINS = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/XML/1998/namespace",
  "https://react.dev/errors/",
  "https://github.com/expo/expo/issues.",
  "https://github.com/react-native-community/cli/blob/master/docs/autolinking.md",
  "https://github.com/gre/bezier-easing",
  "https://docs.expo.dev/versions/latest/sdk/router/",
  "https://docs.expo.dev/versions/latest/sdk/router/#usefocuseffecteffect-do_not_pass_a_second_prop",
  "https://docs.expo.dev/router/reference/focus-handling/",
  "https://docs.expo.dev/router/reference/focus-handling/#pass-dependencies-to-usefocuseffect",
  "https://docs.expo.dev/router/advanced/nesting-navigators/",
  // expo-router's dummy base for parsing relative URLs (never fetched).
  "http://hostname/${c}",
  "http://hostname/",
  // A comment in the HTML template Expo generates.
  "https://necolas.github.io/react-native-web/docs/setup/#root-element",
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Demo markers found under dir: [{file, marker}]. Binary bundles (Hermes) keep strings as plain bytes, so a latin1 read finds them. */
export function findDemoMarkers(dir) {
  const found = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, "latin1");
    for (const marker of DEMO_MARKERS) if (text.includes(marker)) found.push({ file, marker });
  }
  return found;
}

/** http(s) addresses in the built text files that are not on the allow-list. */
export function findExternalOrigins(dir) {
  const found = [];
  for (const file of walk(dir)) {
    if (!/\.(html|js|css|json|svg|txt)$/i.test(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
      if (!ALLOWED_ORIGINS.has(m[0]) && m[0] !== "https://demo.invalid") found.push({ file, url: m[0] });
    }
  }
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const mode = process.argv[2];
  const dir = process.argv[3] ? resolve(process.argv[3]) : "";
  if ((mode !== "--demo" && mode !== "--normal") || !dir) {
    console.error("usage: checkDemoBundle.mjs --demo|--normal <dir>");
    process.exit(2);
  }
  const markers = findDemoMarkers(dir);
  if (mode === "--normal") {
    if (markers.length > 0) {
      for (const m of markers) console.error(`demo code in ${m.file}: ${m.marker}`);
      console.error("check FAILED: a normal build must not contain the browser demo");
      process.exit(1);
    }
    console.log(`demo check OK: no demo code in ${dir}`);
  } else {
    const origins = findExternalOrigins(dir);
    if (origins.length > 0) {
      for (const o of origins) console.error(`external origin in ${o.file}: ${o.url}`);
      console.error("check FAILED: the demo must not reference external origins");
      process.exit(1);
    }
    if (!markers.some((m) => m.marker === "__JOBPROOF_MOBILE_DEMO__")) {
      console.error("check FAILED: the demo bundle does not contain the demo code");
      process.exit(1);
    }
    console.log(`demo check OK: demo present, no external origins in ${dir}`);
  }
}
