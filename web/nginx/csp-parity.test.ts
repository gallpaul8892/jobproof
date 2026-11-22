// @vitest-environment node
// The CloudFront response-headers policy renders infra/terraform/modules/web_static/csp.tftpl; the
// nginx entrypoint generates the policy for the local and compose stack. With a same-origin API
// they must say the same thing (INFRA spec 5.5). A change to one without the other fails here.
// The photos bucket origin (img-src) is the template's one parameter: both sides get the same one.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./40-jobproof-config.sh", import.meta.url));
const cspFile = fileURLToPath(
  new URL("../../infra/terraform/modules/web_static/csp.tftpl", import.meta.url),
);
const ORIGIN = "https://d1234abcd.cloudfront.net";
const PHOTOS = "https://jobproof-dev-photos-123456789012.s3.eu-west-2.amazonaws.com";

/** What Terraform's templatefile() produces: the one parameter filled in. */
const render = (template: string, photosOrigin: string) => template.replaceAll("${photos_origin}", photosOrigin);

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

function nginxPolicy(apiBaseUrl: string, photoOrigin: string = PHOTOS): string {
  const headers = join(dir, "headers.conf");
  const run = spawnSync("sh", [script], {
    env: { PATH: process.env.PATH ?? "", DIST_DIR: dir, HEADERS_FILE: headers, API_BASE_URL: apiBaseUrl, PHOTO_ORIGIN: photoOrigin },
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

describe("csp.tftpl", () => {
  const template = readFileSync(cspFile, "utf8");
  const text = render(template, PHOTOS);

  it("has exactly one parameter, the photos origin, in img-src only", () => {
    expect(template.match(/\$\{[^}]*\}/g)).toEqual(["${photos_origin}"]);
    expect(parse(text, null).get("img-src")).toContain(PHOTOS);
    expect(parse(text, null).get("connect-src")).toEqual(["'self'"]);
  });

  it("is one line with no surrounding whitespace (it becomes a header value)", () => {
    expect(text).toBe(text.trim());
    expect(text).not.toMatch(/[\r\n]/);
    expect(text.length).toBeGreaterThan(50);
  });

  it("has no 'unsafe-' keywords, no wildcard and no external source but the photos origin", () => {
    expect(text).not.toContain("unsafe-");
    expect(text).not.toContain("*");
    expect(template).not.toMatch(/https?:/);
    expect(text.replaceAll(PHOTOS, "")).not.toMatch(/https?:/);
  });

  it("carries the directives the app depends on", () => {
    const policy = parse(text, null);
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:", PHOTOS].sort());
  });
});

describe("parity with the nginx entrypoint", () => {
  it("is the same policy when the API is same-origin", () => {
    const file = parse(render(readFileSync(cspFile, "utf8"), PHOTOS), null);
    const nginx = parse(nginxPolicy(ORIGIN), ORIGIN);
    expect([...nginx.entries()].sort()).toEqual([...file.entries()].sort());
  });

  it("notices a difference (the comparison is not vacuous)", () => {
    const changed = render(readFileSync(cspFile, "utf8"), PHOTOS).replace(
      "object-src 'none'",
      "object-src 'self'",
    );
    const file = parse(changed, null);
    const nginx = parse(nginxPolicy(ORIGIN), ORIGIN);
    expect([...nginx.entries()].sort()).not.toEqual([...file.entries()].sort());
  });

  it("notices a different photos origin", () => {
    const file = parse(render(readFileSync(cspFile, "utf8"), "https://other.example.test"), null);
    const nginx = parse(nginxPolicy(ORIGIN), ORIGIN);
    expect([...nginx.entries()].sort()).not.toEqual([...file.entries()].sort());
  });

  it("defaults the nginx photos origin to the local object store", () => {
    const headers = join(dir, "headers.conf");
    const run = spawnSync("sh", [script], {
      env: { PATH: process.env.PATH ?? "", DIST_DIR: dir, HEADERS_FILE: headers, API_BASE_URL: ORIGIN },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(headers, "utf8")).toContain(`img-src 'self' data: ${ORIGIN} http://localhost:8333;`);
  });
});
