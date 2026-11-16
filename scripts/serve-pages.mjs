// Serves a built Pages site (pages-dist) the way GitHub Pages does, for local checks:
//   node scripts/serve-pages.mjs [dir] [--port=8090] [--base=/jobproof/]
// Files under the base path are served; a directory serves its index.html; an unknown path under
// the base gets 404.html with status 404 (this is what makes deep links work on Pages).
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(root, "pages-dist"));
const port = Number(flag("port", "8090"));
const base = `/${flag("base", "/jobproof/").replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain" };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = decodeURIComponent(url.pathname);
  if (path + "/" === base) {
    res.writeHead(301, { Location: base }).end();
    return;
  }
  if (!path.startsWith(base)) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const rel = normalize(path.slice(base.length)).replace(/^(\.\.[/\\])+/, "");
  let file = join(dir, rel);
  if (!file.startsWith(dir)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith("/")) {
      res.writeHead(301, { Location: `${path}/` }).end();
      return;
    }
    file = join(file, "index.html");
  }
  let status = 200;
  if (!existsSync(file)) {
    file = join(dir, "404.html");
    status = 404;
  }
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(status, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  res.end(readFileSync(file));
});
server.listen(port, "127.0.0.1", () => console.log(`serving ${dir} at http://127.0.0.1:${port}${base}`));
