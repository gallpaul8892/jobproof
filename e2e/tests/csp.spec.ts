import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, API_URL, ManagerApi, signInViaApi } from "./support";

// The real nginx entrypoint writes the CSP; the app is loaded under exactly that policy.
const script = fileURLToPath(new URL("../../web/nginx/40-jobproof-config.sh", import.meta.url));

function generatedCsp(apiBaseUrl: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jobproof-csp-"));
  try {
    execFileSync("sh", [script], {
      env: { PATH: process.env.PATH ?? "", API_BASE_URL: apiBaseUrl, DIST_DIR: dir, HEADERS_FILE: join(dir, "h.conf") },
    });
    const line = readFileSync(join(dir, "h.conf"), "utf8")
      .split("\n")
      .find((l) => l.includes("Content-Security-Policy"))!;
    return /add_header Content-Security-Policy "(.*)" always;/.exec(line)![1];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const apiOrigin = new URL(API_URL).origin;

// Playwright serves a route-fulfilled document without a network address space, and Chrome then
// treats the page as public and blocks its requests to localhost (Local Network Access). The
// header injection below needs that check off; real nginx responses are not affected.
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--disable-features=LocalNetworkAccessChecks"],
  },
});

test("the generated CSP allows only self and the configured API origin", () => {
  const csp = generatedCsp(API_URL);
  const directives = Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  expect(directives["default-src"]).toEqual(["'self'"]);
  expect(directives["connect-src"]).toEqual(["'self'", apiOrigin]);
  // images: the API's photos; data: is allowed for images only
  expect(directives["img-src"]).toEqual(["'self'", "data:", apiOrigin]);
  expect(directives["object-src"]).toEqual(["'none'"]);
  expect(directives["frame-ancestors"]).toEqual(["'none'"]);
  for (const [name, sources] of Object.entries(directives)) {
    for (const source of sources) {
      expect(["'self'", "'none'", "data:", apiOrigin], `${name} source ${source}`).toContain(source);
    }
  }
  expect(csp).not.toMatch(/\*|unsafe-|https?:\/\/(?!localhost:8000)/);
  // a different API origin is the only thing that changes
  expect(generatedCsp("https://api.example.com")).toContain("connect-src 'self' https://api.example.com;");
});

test("login, dashboard, reports, a lightbox and billing load without CSP violations", async ({ page, request }) => {
  const csp = generatedCsp(API_URL);
  const api = await ManagerApi.create(request);
  const withPhotos = (await api.allReports()).find((r) => r.photo_count >= 3)!;

  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  await page.goto("/login");
  await expect(page.getByTestId("demo-accounts")).toBeVisible();
  await expect(page.locator(".brand-mark i").first()).toBeVisible();

  await signInViaApi(page);
  await page.goto("/");
  await expect(page.getByTestId("recent-report-row")).toHaveCount(5);
  await page.goto("/reports");
  await expect(page.getByTestId("reports-table")).toBeVisible();
  await page.goto(`/reports/${withPhotos.id}`);
  const thumb = page.getByTestId("photo-thumb").first();
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await thumb.click();
  const full = page.getByTestId("lightbox").getByRole("img");
  await expect(full).toBeVisible();
  await expect.poll(() => full.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.keyboard.press("Escape");
  await page.goto("/billing");
  await expect(page.getByTestId("invoices-table")).toBeVisible();

  expect(problems).toEqual([]);
});

test("the CSP is really enforced in this test (a blocked origin is reported)", async ({ page }) => {
  const csp = generatedCsp(API_URL);
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  await page.goto("/login");
  const violated = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener("securitypolicyviolation", (e) => resolve(e.violatedDirective));
        const el = document.createElement("div");
        el.setAttribute("style", "color: red");
        el.id = "csp-probe";
        document.body.appendChild(el);
        const s = document.createElement("style");
        s.textContent = "body{color:red}";
        document.head.appendChild(s);
        setTimeout(() => resolve("none"), 1500);
      }),
  );
  // inline <style> is blocked by default-src 'self': proves the policy is applied
  expect(violated).toMatch(/style-src|default-src/);
});
