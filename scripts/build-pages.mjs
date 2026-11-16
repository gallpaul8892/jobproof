// Builds the whole GitHub Pages site into pages-dist/:
//   /            landing page (pages/landing)
//   /web/        the Manager web demo        (vite --mode pages, mock API in web/src/mock)
//   /mobile/     the Operative mobile demo   (expo export --platform web, stand-ins in mobile/demo)
//   /404.html    deep-link fallback for both apps
// Usage: node scripts/build-pages.mjs [--base=/jobproof/]
// Everything runs offline from committed data; no secrets and no network calls at run time.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = join(root, "pages-dist");
const baseArg = process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? process.env.PAGES_BASE ?? "/jobproof/";
const trimmed = baseArg.trim().replace(/^\/+|\/+$/g, "");
/** Always a leading and a trailing slash: "/jobproof/", or "/" for a site served from the root. */
const base = trimmed === "" ? "/" : `/${trimmed}/`;

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...options });
const mockSettings = JSON.parse(readFileSync(join(root, "web/src/mock/mockData.json"), "utf8")).settings;
const operative = JSON.parse(readFileSync(join(root, "mobile/demo/mock/operativeData.json"), "utf8")).account;

// 1. Start clean. `out` is the fixed folder above, never user input.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 2. The Manager web demo, served from <base>web/.
run("npm", ["run", "build:pages", "-w", "@jobproof/web"], { env: { ...process.env, VITE_BASE: `${base}web/`, VITE_DEMO_HOME: base } });
cpSync(join(root, "web/dist-pages"), join(out, "web"), { recursive: true });

// 3. The Operative mobile demo, served from <base>mobile/ (Metro swaps in the in-browser stand-ins).
const mobileOut = join(root, "mobile/dist-pages");
rmSync(mobileOut, { recursive: true, force: true });
run("npx", ["expo", "export", "--platform", "web", "--output-dir", mobileOut], {
  cwd: join(root, "mobile"),
  env: { ...process.env, CI: "1", JOBPROOF_DEMO: "1", DEMO_BASE_URL: `${base}mobile`, EXPO_PUBLIC_DEMO_HOME_URL: base },
});
run("node", ["demo/checkDemoBundle.mjs", "--demo", mobileOut], { cwd: join(root, "mobile") });
cpSync(mobileOut, join(out, "mobile"), { recursive: true });
// The demo ships no icon file: say so in the page, so the browser does not ask for /favicon.ico (a 404).
const mobileIndex = join(out, "mobile", "index.html");
const mobileHtml = readFileSync(mobileIndex, "utf8");
if (!mobileHtml.includes("<title>")) throw new Error("build-pages: unexpected mobile index.html (no <title>)");
writeFileSync(mobileIndex, mobileHtml.replace("<title>", '<link rel="icon" href="data:," />\n    <title>'));

// 4. The landing page. Theme colours come from the demo's own settings data, never from a literal here.
const theme = mockSettings.theme;
const vars = { primary: "--jp-primary", accent: "--jp-accent", background: "--jp-bg", surface: "--jp-surface", text: "--jp-text" };
const themeCss = `:root{${Object.entries(vars).map(([k, v]) => `${v}:${theme[k]}`).join(";")}}`;
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const landing = readFileSync(join(root, "pages/landing/index.html"), "utf8")
  .replace("{{THEME}}", themeCss)
  .replace("{{OPERATIVE_EMAIL}}", escapeHtml(operative.email))
  .replace("{{OPERATIVE_PASSWORD}}", escapeHtml(operative.password));
if (landing.includes("{{")) throw new Error("build-pages: an unreplaced {{placeholder}} is left in the landing page");
writeFileSync(join(out, "index.html"), landing);
cpSync(join(root, "pages/landing/landing.css"), join(out, "landing.css"));

// 5. 404.html: GitHub Pages serves it for every unknown path. A refresh on a deep link such as
//    <base>web/reports/<id> or <base>mobile/jobs/<id> comes here; it loads that app's own index.html
//    in place (the address bar is not touched, so the router takes over). Anything else goes to the landing page.
const fallback = `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JobProof demos</title>
    <link rel="icon" href="data:," />
    <script>
      (function () {
        var base = ${JSON.stringify(base)};
        var path = location.pathname;
        var app = null;
        ["web", "mobile"].forEach(function (name) {
          if (path === base + name || path.indexOf(base + name + "/") === 0) app = name;
        });
        if (!app) { location.replace(base); return; }
        fetch(base + app + "/index.html", { credentials: "same-origin" })
          .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.text(); })
          .then(function (html) { document.open(); document.write(html); document.close(); })
          .catch(function () { location.replace(base + app + "/"); });
      })();
    </script>
  </head>
  <body>
    <noscript><p>These demos need JavaScript. <a href=${JSON.stringify(base)}>Back to the demos</a></p></noscript>
  </body>
</html>
`;
writeFileSync(join(out, "404.html"), fallback);
writeFileSync(join(out, ".nojekyll"), "");

for (const f of ["index.html", "404.html", "web/index.html", "mobile/index.html"]) {
  if (!existsSync(join(out, f))) throw new Error(`build-pages: ${f} is missing from the output`);
}
console.log(`build-pages OK: ${out} (base ${base})`);
