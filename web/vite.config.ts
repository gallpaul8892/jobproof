import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** `/`, `/jobproof` or `jobproof/` all become a path with a leading and a trailing slash. */
function normaliseBase(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * GitHub Pages demo (`vite build --mode pages`): the API is answered in the browser, so there is
 * no runtime config file to load. Normal builds are untouched.
 */
function pagesDemo(): Plugin {
  return {
    name: "jobproof-pages-demo",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replace(/\s*<script src="\/config\.js"><\/script>/, ""),
    },
  };
}

export default defineConfig(({ mode }) => {
  const pages = mode === "pages";
  // VITE_BASE comes from the environment or web/.env*; the Pages workflow sets /jobproof/.
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  return {
    base: normaliseBase(env.VITE_BASE),
    plugins: [react(), ...(pages ? [pagesDemo()] : [])],
    // The demo has no config.js (web/public holds only that file).
    publicDir: pages ? false : "public",
    server: { port: 8080, strictPort: true, host: "0.0.0.0" },
    preview: { port: 8080, strictPort: true, host: "0.0.0.0" },
    build: { target: "es2022", sourcemap: false },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "nginx/**/*.test.ts"],
      setupFiles: ["src/test/setup.ts"],
      testTimeout: 60_000,
    },
  };
});
