// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findExternalOrigins } from "./dist-origins.mjs";

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

  it("references no external origin", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jobproof-dist-"));
    try {
      const webRoot = fileURLToPath(new URL("..", import.meta.url));
      execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "silent"], {
        cwd: webRoot,
        env: { ...process.env, NODE_ENV: "production" },
      });
      expect(findExternalOrigins(outDir)).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
