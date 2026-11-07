// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./40-jobproof-config.sh", import.meta.url));
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jobproof-cfg-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(value: string | undefined) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", DIST_DIR: dir, HEADERS_FILE: join(dir, "headers.conf") };
  if (value !== undefined) env.API_BASE_URL = value;
  return spawnSync("sh", [script], { env, encoding: "utf8" });
}

const bad: [string, string][] = [
  ["embedded newline injection", 'http://ok\n" always;\nadd_header X-Evil "1'],
  ["carriage return", "http://ok\rhttp://evil"],
  ["trailing newline", "http://localhost:8000\n"],
  ["leading newline", "\nhttp://localhost:8000"],
  ["tab", "http://local\thost"],
  ["quote injection", 'http://ok"; add_header X-Evil "1'],
  ["backslash", "http://ok\\evil"],
  ["semicolon", "http://ok;evil"],
  ["space", "http://ok evil"],
  ["empty", ""],
  ["path suffix", "https://api.example.com/v1"],
  ["query suffix", "https://api.example.com?x=1"],
  ["fragment suffix", "https://api.example.com#x"],
  ["userinfo", "https://user@api.example.com"],
  ["ftp scheme", "ftp://api.example.com"],
  ["javascript scheme", "javascript:alert(1)"],
  ["no scheme", "api.example.com"],
  ["scheme only", "http://"],
];

describe("40-jobproof-config.sh", () => {
  it.each(bad)("rejects %s and writes nothing", (_name, value) => {
    const r = run(value);
    expect(r.status).not.toBe(0);
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each([
    ["http://localhost:8000", "http://localhost:8000"],
    ["https://api.example.com", "https://api.example.com"],
    ["https://api.example.com:8443", "https://api.example.com:8443"],
    ["https://api.example.com/", "https://api.example.com"],
  ])("accepts %s", (value, origin) => {
    const r = run(value);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, "config.js"), "utf8")).toBe(
      `window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "${origin}"};\n`,
    );
    const headers = readFileSync(join(dir, "headers.conf"), "utf8");
    expect(headers).toContain(`img-src 'self' data: ${origin};`);
    expect(headers).toContain(`connect-src 'self' ${origin};`);
    expect(headers.trim().split("\n")).toHaveLength(3);
  });

  it("defaults to http://localhost:8000 when unset", () => {
    expect(run(undefined).status).toBe(0);
    expect(readFileSync(join(dir, "config.js"), "utf8")).toContain("http://localhost:8000");
  });
});
