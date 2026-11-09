// A local stand-in for the CloudFront distribution, used to test smoke-test.sh without AWS.
//
//   node infra/scripts/local-edge.mjs   (env: PORT, DIST, UPSTREAM, CONFIG_DIR, CSP_FILE, EDGE_BREAK)
//
// Serves the built SPA with an index.html fallback (the CloudFront Function), forwards /api/* and
// /health* to the upstream API unchanged, and adds the response headers of the policy. It is a
// test double: nothing here is deployed. EDGE_BREAK (comma separated) breaks it on purpose so a
// test can show that the smoke test notices: no-csp, bad-csp, no-nosniff, spa-on-api, no-config,
// wrong-config, no-assets, no-hsts.
import { createServer, request as httpRequest } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

export function startEdge({
  port = 0,
  dist,
  upstream,
  configDir = null,
  cspFile = join(here, "../terraform/modules/web_static/csp.txt"),
  breakWith = [],
  https = false,
}) {
  const csp = readFileSync(cspFile, "utf8");
  const broken = new Set(breakWith);
  const root = resolve(dist);
  const target = new URL(upstream);

  function addHeaders(res) {
    if (!broken.has("no-csp")) {
      res.setHeader("Content-Security-Policy", broken.has("bad-csp") ? `${csp}; script-src *` : csp);
    }
    if (!broken.has("no-nosniff")) res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (https && !broken.has("no-hsts")) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }

  function sendFile(res, file) {
    addHeaders(res);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }

  function spa(res) {
    sendFile(res, join(root, "index.html"));
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://edge.invalid");
    const path = url.pathname;
    if (path.startsWith("/api/") || path === "/health" || path.startsWith("/health/")) {
      const proxied = httpRequest(
        { host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers },
        (up) => {
          if (broken.has("spa-on-api") && up.statusCode === 404) {
            up.resume();
            return spa(res);
          }
          addHeaders(res);
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      proxied.on("error", () => {
        res.writeHead(502).end();
      });
      req.pipe(proxied);
      return;
    }
    if (path === "/config.js") {
      if (broken.has("no-config")) return res.writeHead(404).end();
      const base = configDir ? resolve(configDir) : root;
      const file = join(base, "config.js");
      if (broken.has("wrong-config")) {
        addHeaders(res);
        res.writeHead(200, { "Content-Type": TYPES[".js"] });
        return res.end('window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "http://localhost:8000"};\n');
      }
      return existsSync(file) ? sendFile(res, file) : res.writeHead(404).end();
    }
    const file = normalize(join(root, decodeURIComponent(path)));
    const isAsset = path.startsWith("/assets/");
    if (
      file.startsWith(root + sep) &&
      existsSync(file) &&
      statSync(file).isFile() &&
      !(isAsset && broken.has("no-assets"))
    ) {
      return sendFile(res, file);
    }
    if (isAsset) return res.writeHead(404).end();
    return spa(res);
  });

  return new Promise((resolveStart) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolveStart({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const edge = await startEdge({
    port: Number(process.env.PORT ?? 8090),
    dist: process.env.DIST ?? join(here, "../../web/dist"),
    upstream: process.env.UPSTREAM ?? "http://127.0.0.1:8000",
    configDir: process.env.CONFIG_DIR ?? null,
    cspFile: process.env.CSP_FILE ?? undefined,
    breakWith: (process.env.EDGE_BREAK ?? "").split(",").filter(Boolean),
  });
  console.log(`local-edge listening on ${edge.url}`);
}
