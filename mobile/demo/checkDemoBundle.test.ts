import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(__dirname, "checkDemoBundle.mjs");
const run = (mode: string, dir: string) => spawnSync("node", [script, mode, dir], { encoding: "utf8" });

describe("checkDemoBundle", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "demo-check-"));
    mkdirSync(join(dir, "js"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("--normal passes a bundle without the demo and fails one with it (also inside a binary file)", () => {
    writeFileSync(join(dir, "js", "app.js"), "console.log('plain app')");
    expect(run("--normal", dir).status).toBe(0);
    writeFileSync(join(dir, "js", "app.hbc"), Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from("__JOBPROOF_MOBILE_DEMO__"), Buffer.from([0])]));
    const result = run("--normal", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("__JOBPROOF_MOBILE_DEMO__");
  });

  it("--demo needs the demo code and rejects an external origin", () => {
    writeFileSync(join(dir, "js", "a.js"), "plain");
    expect(run("--demo", dir).status).toBe(1);
    writeFileSync(join(dir, "js", "a.js"), "window.__JOBPROOF_MOBILE_DEMO__ = true; // https://demo.invalid");
    expect(run("--demo", dir).status).toBe(0);
    writeFileSync(join(dir, "js", "b.js"), 'fetch("https://cdn.example.com/x.js")');
    const result = run("--demo", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("https://cdn.example.com/x.js");
  });

  it("explains its usage with a wrong call", () => {
    expect(run("--other", dir).status).toBe(2);
    void execFileSync;
  });
});
