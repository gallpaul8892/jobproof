// @vitest-environment node
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { ALLOWED, findExternalOrigins, findMockCode } from "./dist-origins.mjs";

describe("production bundle", () => {
  it("scanner flags external origins and allows XML namespaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "dist-scan-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "ok.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      writeFileSync(join(dir, "assets", "bad.js"), 'fetch("https://cdn.example.com/x.js")');
      const found = findExternalOrigins(dir);
      expect(found.map((f) => f.url)).toEqual(["https://cdn.example.com/x.js"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows exactly the seven listed strings and rejects near-misses", () => {
    const dir = mkdtempSync(join(tmpdir(), "dist-scan-"));
    try {
      writeFileSync(join(dir, "ok.js"), [...ALLOWED].map((u) => `"${u}"`).join("\n"));
      expect(ALLOWED.size).toBe(7);
      expect(findExternalOrigins(dir)).toEqual([]);
      writeFileSync(
        join(dir, "bad.js"),
        [
          "http://www.w3.org/2000/svg/extra",
          "https://react.dev/errors/123",
          "http://localhost:8000",
          "https://fake.example.com/x",
        ].map((u) => `"${u}"`).join("\n"),
      );
      expect(findExternalOrigins(dir).map((f) => f.url)).toEqual([
        "http://www.w3.org/2000/svg/extra",
        "https://react.dev/errors/123",
        "http://localhost:8000",
        "https://fake.example.com/x",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("references no external origin", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jobproof-dist-"));
    try {
      const webRoot = fileURLToPath(new URL("..", import.meta.url));
      execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "silent"], {
        cwd: webRoot,
        env: { ...process.env, NODE_ENV: "production" },
      });
      expect(findExternalOrigins(outDir)).toEqual([]);
      // The GitHub Pages demo's mock API and data must not be in a real build.
      expect(findMockCode(outDir)).toEqual([]);
      expect(readdirSync(join(outDir, "assets")).filter((f) => /mock/i.test(f))).toEqual([]);
      expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain('src="/config.js"');
      expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain('src="/assets/');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("builds the Pages demo under a base path, with the mock API and no config.js", () => {
    const outDir = mkdtempSync(join(tmpdir(), "jobproof-pages-"));
    try {
      const webRoot = fileURLToPath(new URL("..", import.meta.url));
      execFileSync("npx", ["vite", "build", "--mode", "pages", "--outDir", outDir, "--emptyOutDir", "--logLevel", "silent"], {
        cwd: webRoot,
        env: { ...process.env, NODE_ENV: "production", VITE_BASE: "/jobproof/" },
      });
      expect(findExternalOrigins(outDir)).toEqual([]);
      expect(findMockCode(outDir).length).toBeGreaterThan(0);
      const html = readFileSync(join(outDir, "index.html"), "utf8");
      expect(html).toContain('src="/jobproof/assets/');
      expect(html).not.toContain("config.js");
      expect(existsSync(join(outDir, "config.js"))).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
