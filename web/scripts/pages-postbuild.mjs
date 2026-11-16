// After `vite build --mode pages`: make the output ready for GitHub Pages.
//  - 404.html: a copy of index.html. It makes this folder work on its own (a static host with a
//    404 fallback, `npm run preview:pages -w @jobproof/web`). On GitHub Pages the whole site is built
//    by scripts/build-pages.mjs, whose root 404.html loads this app's index.html for /jobproof/web/...
//  - .nojekyll: Pages must not run Jekyll over the files.
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-pages");
const index = join(dist, "index.html");
if (!existsSync(index)) {
  console.error("pages-postbuild: dist/index.html is missing; run vite build --mode pages first");
  process.exit(1);
}
copyFileSync(index, join(dist, "404.html"));
writeFileSync(join(dist, ".nojekyll"), "");
console.log("pages-postbuild OK: dist-pages/404.html and dist-pages/.nojekyll written");
