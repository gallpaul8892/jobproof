// @vitest-environment node
// The CloudFront response-headers policy reads infra/terraform/modules/web_static/csp.txt; the
// nginx entrypoint generates the policy for the local and compose stack. With a same-origin API
// they must say the same thing (INFRA spec 5.5). A change to one without the other fails here.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./40-jobproof-config.sh", import.meta.url));
const cspFile = fileURLToPath(
  new URL("../../infra/terraform/modules/web_static/csp.txt", import.meta.url),
);
const ORIGIN = "https://d1234abcd.cloudfront.net";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jobproof-csp-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** directive name -> sorted set of source tokens, with `origin` read as 'self'. */
function parse(policy: string, origin: string | null): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    expect(result.has(name), `duplicate directive ${name}`).toBe(false);
    const mapped = sources.map((s) => (origin !== null && s === origin ? "'self'" : s));
    result.set(name, [...new Set(mapped)].sort());
  }
  return result;
}

function nginxPolicy(apiBaseUrl: string): string {
  const headers = join(dir, "headers.conf");
  const run = spawnSync("sh", [script], {
    env: { PATH: process.env.PATH ?? "", DIST_DIR: dir, HEADERS_FILE: headers, API_BASE_URL: apiBaseUrl },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  const line = readFileSync(headers, "utf8")
    .split("\n")
    .find((l) => l.startsWith("add_header Content-Security-Policy "));
  const match = line?.match(/^add_header Content-Security-Policy "(.*)" always;$/);
  expect(match, "CSP line in the generated include").not.toBeNull();
  return match![1];
}

describe("csp.txt", () => {
  const text = readFileSync(cspFile, "utf8");

  it("is one line with no surrounding whitespace (it becomes a header value)", () => {
    expect(text).toBe(text.trim());
    expect(text).not.toMatch(/[\r\n]/);
    expect(text.length).toBeGreaterThan(50);
  });

  it("has no 'unsafe-' keywords and no wildcard or external source", () => {
    expect(text).not.toContain("unsafe-");
    expect(text).not.toContain("*");
    expect(text).not.toMatch(/https?:/);
  });

  it("carries the directives the app depends on", () => {
    const policy = parse(text, null);
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:"]);
  });
});

describe("parity with the nginx entrypoint", () => {
  it("is the same policy when the API is same-origin", () => {
    const file = parse(readFileSync(cspFile, "utf8"), null);
    const nginx = parse(nginxPolicy(ORIGIN), ORIGIN);
    expect([...nginx.entries()].sort()).toEqual([...file.entries()].sort());
  });

  it("notices a difference (the comparison is not vacuous)", () => {
    const changed = readFileSync(cspFile, "utf8").replace("object-src 'none'", "object-src 'self'");
    const file = parse(changed, null);
    const nginx = parse(nginxPolicy(ORIGIN), ORIGIN);
    expect([...nginx.entries()].sort()).not.toEqual([...file.entries()].sort());
  });
});
