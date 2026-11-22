import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, API_URL, PAINTER, PHOTOS_URL, ManagerApi, reseed, signInViaApi } from "./support";
import { AFTER_PHOTO, BEFORE_PHOTO, type TestPhoto } from "./photo-fixtures";

// T-003g: a photo uploaded from the operative app is shown to the manager from the object store,
// under the real CSP (img-src allows the photos origin and nothing wider). Dan submits his job
// JP-1061 through the operative API; this changes the data for everyone, so this file runs last
// (playwright.config.ts) and reseeds before each test and at the end.
test.beforeEach(() => reseed());
test.afterAll(() => reseed());

const script = fileURLToPath(new URL("../../web/nginx/40-jobproof-config.sh", import.meta.url));
function generatedCsp(): string {
  const dir = mkdtempSync(join(tmpdir(), "jobproof-csp-"));
  try {
    execFileSync("sh", [script], {
      env: {
        PATH: process.env.PATH ?? "",
        API_BASE_URL: API_URL,
        PHOTO_ORIGIN: PHOTOS_URL,
        DIST_DIR: dir,
        HEADERS_FILE: join(dir, "h.conf"),
      },
    });
    const line = readFileSync(join(dir, "h.conf"), "utf8")
      .split("\n")
      .find((l) => l.includes("Content-Security-Policy"))!;
    return /add_header Content-Security-Policy "(.*)" always;/.exec(line)![1];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--disable-features=LocalNetworkAccessChecks"],
  },
});

type Request = import("@playwright/test").APIRequestContext;

async function submitAsDan(request: Request): Promise<string> {
  const signIn = await request.post(`${API_URL}/api/v1/auth/sessions`, {
    data: {
      email: PAINTER.email,
      password: PAINTER.password,
      device_id: randomUUID(),
      device_name: "e2e phone",
      platform: "android",
      app_version: "1.0.0",
    },
  });
  expect(signIn.status(), "device sign-in").toBe(201);
  const headers = { Authorization: `Bearer ${((await signIn.json()) as { access_token: string }).access_token}` };
  const base = `${API_URL}/api/v1/operative/jobs`;

  const list = (await (await request.get(base, { headers })).json()) as {
    jobs_today: { id: string; reference: string; checklist: { id: string }[] }[];
  };
  const job = list.jobs_today.find((j) => j.reference === "JP-1061")!;
  const ticked = await request.patch(`${base}/${job.id}/report`, {
    headers,
    data: { notes: "Finished early", checklist: job.checklist.map((i) => ({ item_id: i.id, status: "done" })) },
  });
  expect(ticked.status()).toBe(200);

  const now = new Date().toISOString();
  const send = async (stage: "before" | "after", photo: TestPhoto) => {
    const id = randomUUID();
    const registered = await request.put(`${base}/${job.id}/photos/${id}`, {
      headers,
      data: {
        stage,
        caption: `Uploaded ${stage} photo`,
        source: "camera",
        taken_at: now,
        taken_at_source: "device_clock",
        device_sent_at: now,
        original: { width: 128, height: 96, bytes: photo.bytes.length + 500, sha256: photo.sha256 },
        upload: {
          width: photo.width,
          height: photo.height,
          bytes: photo.bytes.length,
          sha256: photo.sha256,
          content_type: "image/jpeg",
        },
      },
    });
    expect(registered.status(), `register ${stage}`).toBe(201);
    const uploaded = await request.put(`${base}/${job.id}/photos/${id}/content`, {
      headers: { ...headers, "Content-Type": "image/jpeg" },
      data: photo.bytes,
    });
    expect(uploaded.status(), `upload ${stage}`).toBe(200);
    return id;
  };
  const ids = [await send("before", BEFORE_PHOTO), await send("after", AFTER_PHOTO)];
  const submitted = await request.post(`${base}/${job.id}/report/submit`, {
    headers,
    data: { submission_id: randomUUID(), device_submitted_at: now, device_sent_at: now, photo_ids: ids },
  });
  expect(submitted.status(), "submit").toBe(200);
  return ((await submitted.json()) as { report: { id: string } }).report.id;
}

test("uploaded photos load from the photos origin under the production CSP", async ({ page, request }) => {
  const reportId = await submitAsDan(request);
  const api = await ManagerApi.create(request);
  const detail = await api.get<{ photos: { url: string; thumb_url: string }[] }>(`reports/${reportId}`);
  expect(detail.photos).toHaveLength(2);
  for (const photo of detail.photos) {
    expect(photo.url.startsWith(PHOTOS_URL)).toBe(true);
    expect(photo.thumb_url.startsWith(PHOTOS_URL)).toBe(true);
  }

  const csp = generatedCsp();
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const photoRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(PHOTOS_URL)) photoRequests.push(r.url());
  });

  await signInViaApi(page);
  await page.goto(`/reports/${reportId}`);
  const thumbs = page.getByTestId("photo-thumb");
  await expect(thumbs).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const image = thumbs.nth(i).locator("img");
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await thumbs.first().click();
  const full = page.getByTestId("lightbox").getByRole("img");
  await expect(full).toBeVisible();
  await expect.poll(() => full.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  expect(photoRequests.length).toBeGreaterThanOrEqual(3);
  expect(problems).toEqual([]);
});
