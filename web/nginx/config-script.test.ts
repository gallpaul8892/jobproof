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

/** A syntactically valid host name (labels of 50 characters) of exactly `length` characters. */
function longHost(length: number): string {
  const labels: string[] = [];
  let used = 0;
  while (used < length) {
    const remaining = length - used - (labels.length > 0 ? 1 : 0);
    const size = Math.min(50, remaining);
    labels.push("a".repeat(size));
    used += size + (labels.length > 1 ? 1 : 0);
  }
  return labels.join(".");
}

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
  ["command substitution $()", "http://$(touch /tmp/pwned).example.com"],
  ["command substitution without spaces", "http://$(id).example.com"],
  ["backticks", "http://`id`.example.com"],
  ["variable expansion", "http://${HOME}.example.com"],
  ["Cyrillic look-alike letter", "https://\u0430pi.example.com"],
  ["Greek look-alike letter", "https://api.ex\u03b1mple.com"],
  ["fullwidth letters", "https://\uff41\uff50\uff49.example.com"],
  ["fullwidth colon and slash", "https://api.example.com\uff1a8443"],
  ["accented letter", "https://caf\u00e9.example.com"],
  ["zero-width space", "https://api.exam\u200bple.com"],
  ["internationalised domain label", "https://\u4f8b\u3048.jp"],
  ["uppercase scheme", "HTTPS://api.example.com"],
  ["mixed-case scheme", "Http://api.example.com"],
  ["label starting with a hyphen", "https://-api.example.com"],
  ["label ending with a hyphen", "https://api-.example.com"],
  ["later label starting with a hyphen", "https://api.-example.com"],
  ["host that is only a hyphen", "http://-"],
  ["host that is only a dot", "http://."],
  ["leading dot", "http://.example.com"],
  ["trailing dot", "http://example.com."],
  ["empty label", "http://api..example.com"],
  ["port without host", "http://:8000"],
  ["empty port", "http://localhost:"],
  ["non-numeric port", "http://localhost:80a0"],
  ["port too long", "http://localhost:123456"],
  ["two ports", "http://localhost:80:90"],
  ["origin of 254 characters", `http://${longHost(254 - "http://".length)}`],
  ["origin of 10000 characters", `http://${longHost(10_000 - "http://".length)}`],
  ["very long single label", `http://${"a".repeat(5000)}`],
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
    ["http://localhost", "http://localhost"],
    ["https://a.b-c.example.com", "https://a.b-c.example.com"],
    ["https://1-2.example.com:65535", "https://1-2.example.com:65535"],
    ["http://127.0.0.1:8000", "http://127.0.0.1:8000"],
    ["https://xn--caf-dma.example.com", "https://xn--caf-dma.example.com"],
    [`http://${longHost(253 - "http://".length)}`, `http://${longHost(253 - "http://".length)}`],
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

  it("does not execute command substitution", () => {
    run("http://$(touch " + join(dir, "pwned") + ").example.com");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("defaults to http://localhost:8000 when unset", () => {
    expect(run(undefined).status).toBe(0);
    expect(readFileSync(join(dir, "config.js"), "utf8")).toContain("http://localhost:8000");
  });
});
