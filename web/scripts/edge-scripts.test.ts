// @vitest-environment node
// Tests for infra/scripts/upload-web.sh and smoke-test.sh without AWS: upload against a
// recording stub of the AWS CLI, smoke test against a local stand-in for CloudFront.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ES module without types
import { startEdge } from "../../infra/scripts/local-edge.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const uploadScript = join(root, "infra/scripts/upload-web.sh");
const smokeScript = join(root, "infra/scripts/smoke-test.sh");
const cspFile = join(root, "infra/terraform/modules/web_static/csp.txt");

let work: string;
let dist: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "jobproof-edge-"));
  dist = join(work, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><html><head><script src="/config.js"></script>' +
      '<script type="module" src="/assets/index-abc123.js"></script></head>' +
      '<body><div id="root"></div></body></html>',
  );
  writeFileSync(join(dist, "assets/index-abc123.js"), "console.log(1)");
  writeFileSync(join(dist, "assets/index-abc123.css"), "body{}");
  writeFileSync(join(dist, "favicon.svg"), "<svg/>");
  writeFileSync(join(dist, "config.js"), 'window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "http://localhost:8000"};\n');
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

// ---- upload-web.sh --------------------------------------------------------------------------

function stubAws(): { bin: string; log: string } {
  const bin = join(work, "aws-stub.sh");
  const log = join(work, "aws-calls.log");
  writeFileSync(log, "");
  // Records each call and, for "s3 cp <config.js>", keeps a copy of what would be uploaded.
  writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
if [ "$1 $2" = "s3 cp" ]; then
  case "$3" in */config.js) cat "$3" > "${work}/uploaded-config.js" ;; esac
fi
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

function upload(env: Record<string, string>) {
  const { bin, log } = stubAws();
  const run = spawnSync("bash", [uploadScript], {
    env: { PATH: process.env.PATH ?? "", AWS_BIN: bin, WEB_DIST: dist, ...env },
    encoding: "utf8",
  });
  return { run, calls: readFileSync(log, "utf8").split("\n").filter(Boolean) };
}

describe("upload-web.sh", () => {
  const env = { WEB_BUCKET: "jobproof-dev-web", SITE_URL: "https://d1234abcd.cloudfront.net" };

  it("uploads assets, then other files, then config.js, then index.html", () => {
    const { run, calls } = upload({ ...env, DISTRIBUTION_ID: "E123ABC" });
    expect(run.status, run.stderr).toBe(0);
    expect(calls).toHaveLength(5);
    expect(calls[0]).toMatch(/^s3 sync .*\/assets s3:\/\/jobproof-dev-web\/assets /);
    expect(calls[0]).toContain("max-age=31536000,immutable");
    expect(calls[1]).toMatch(/^s3 sync .* s3:\/\/jobproof-dev-web --only-show-errors/);
    expect(calls[1]).toContain('--exclude assets/*');
    expect(calls[1]).toContain("--exclude index.html");
    expect(calls[1]).toContain("--exclude config.js");
    expect(calls[2]).toMatch(/^s3 cp .*\/config\.js s3:\/\/jobproof-dev-web\/config\.js /);
    expect(calls[2]).toContain("no-store");
    expect(calls[3]).toMatch(/^s3 cp .*\/index\.html s3:\/\/jobproof-dev-web\/index\.html /);
    expect(calls[3]).toContain("no-store");
    expect(calls[4]).toBe(
      "cloudfront create-invalidation --distribution-id E123ABC --paths /index.html /config.js",
    );
  });

  it("never deletes anything in the bucket", () => {
    const { calls } = upload(env);
    expect(calls.join("\n")).not.toContain("--delete");
    expect(calls.join("\n")).not.toMatch(/\brm\b/);
  });

  it("uploads a generated config.js for this site, not the dist's development one", () => {
    const { run } = upload(env);
    expect(run.status, run.stderr).toBe(0);
    const uploaded = readFileSync(join(work, "uploaded-config.js"), "utf8");
    expect(uploaded).toBe(
      'window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "https://d1234abcd.cloudfront.net"};\n',
    );
    expect(readFileSync(join(dist, "config.js"), "utf8")).toContain("localhost:8000"); // untouched
  });

  it("skips the invalidation without a distribution id", () => {
    const { calls } = upload(env);
    expect(calls.some((c) => c.startsWith("cloudfront"))).toBe(false);
  });

  it.each([
    ["no bucket", { SITE_URL: env.SITE_URL }, "WEB_BUCKET is required"],
    ["no site url", { WEB_BUCKET: env.WEB_BUCKET }, "SITE_URL is required"],
    ["http site url", { ...env, SITE_URL: "http://d1.cloudfront.net" }, "must start with https://"],
    ["path in site url", { ...env, SITE_URL: "https://d1.cloudfront.net/x" }, "rejected"],
    ["quote in site url", { ...env, SITE_URL: 'https://d1.cloudfront.net"; x' }, "rejected"],
    ["bad bucket", { ...env, WEB_BUCKET: "s3://bucket" }, "bucket name"],
    ["missing dist", { ...env, WEB_DIST: "/nonexistent-dist-dir" }, "not found"],
  ])("refuses %s and uploads nothing", (_name, vars, message) => {
    const { run, calls } = upload(vars as Record<string, string>);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(message);
    expect(calls).toEqual([]);
  });

  it("stops at the first failing step and does not publish index.html", () => {
    const bin = join(work, "aws-fail.sh");
    const log = join(work, "aws-fail.log");
    writeFileSync(log, "");
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$*" in *"/assets "*) exit 1 ;; esac\n`);
    chmodSync(bin, 0o755);
    const run = spawnSync("bash", [uploadScript], {
      env: { PATH: process.env.PATH ?? "", AWS_BIN: bin, WEB_DIST: dist, ...env },
      encoding: "utf8",
    });
    expect(run.status).not.toBe(0);
    expect(readFileSync(log, "utf8")).not.toContain("index.html");
  });
});

// ---- smoke-test.sh --------------------------------------------------------------------------

let upstream: Server;
let upstreamUrl: string;
beforeAll(async () => {
  upstream = createServer((req, res) => {
    const json = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? "").split("?")[0];
    if (path === "/health/live") return json(200, { status: "ok" });
    if (path === "/health") return json(200, { status: "ok", database: "ok", version: "0.1.0" });
    if (path === "/api/v1/branding") return json(200, { company_name: "Arbour Services" });
    if (path === "/api/v1/manager/dashboard") {
      return json(401, { code: "unauthenticated" }, "application/problem+json");
    }
    if (path === "/api/v1/auth/login" && req.method === "POST") {
      return json(200, { access_token: "tok" });
    }
    if (path === "/api/v1/auth/me") {
      return req.headers.authorization === "Bearer tok"
        ? json(200, { role: "manager" })
        : json(401, { code: "unauthenticated" }, "application/problem+json");
    }
    return json(404, { code: "not_found" }, "application/problem+json");
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  const address = upstream.address();
  upstreamUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => new Promise<void>((done) => upstream.close(() => done())));

async function smoke(breakWith: string[] = [], env: Record<string, string> = {}) {
  const configDir = mkdtempSync(join(work, "cfg-"));
  const edge = await startEdge({ dist, upstream: upstreamUrl, configDir, cspFile, breakWith });
  try {
    writeFileSync(
      join(configDir, "config.js"),
      `window.__JOBPROOF_CONFIG__ = {"apiBaseUrl": "${edge.url}"};\n`,
    );
    return await new Promise<{ status: number | null; out: string }>((done) => {
      const child = spawn("bash", [smokeScript, edge.url], {
        env: { PATH: process.env.PATH ?? "", SMOKE_WAIT_SECONDS: "0", ...env },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (status) => done({ status, out }));
    });
  } finally {
    await edge.close();
  }
}

describe("smoke-test.sh", () => {
  it("passes against a correctly configured edge", async () => {
    const { status, out } = await smoke();
    expect(out).toContain("all checks passed");
    expect(status).toBe(0);
  });

  it("signs in when credentials are given, without printing them", async () => {
    const { status, out } = await smoke([], { SMOKE_EMAIL: "a@b.test", SMOKE_PASSWORD: "s3cret-pass" });
    expect(status).toBe(0);
    expect(out).toContain("sign-in and /auth/me");
    expect(out).not.toContain("s3cret-pass");
  });

  it.each([
    ["no-csp", "Content-Security-Policy differs"],
    ["bad-csp", "Content-Security-Policy differs"],
    ["no-nosniff", "X-Content-Type-Options"],
    ["spa-on-api", "unknown API path returned 200"],
    ["no-config", "/config.js returned 404"],
    ["wrong-config", "apiBaseUrl is not"],
    ["no-assets", "returned 404"],
  ])("fails when the edge is broken with %s", async (breakage, message) => {
    const { status, out } = await smoke([breakage]);
    expect(status).not.toBe(0);
    expect(out).toContain("FAIL");
    expect(out).toContain(message);
  });

  it("fails when /health/live never answers", async () => {
    const run = spawnSync("bash", [smokeScript, "http://127.0.0.1:9"], {
      env: { PATH: process.env.PATH ?? "", SMOKE_WAIT_SECONDS: "0" },
      encoding: "utf8",
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("/health/live did not return 200");
  });

  it("needs an address", () => {
    const run = spawnSync("bash", [smokeScript], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("usage");
  });
});
