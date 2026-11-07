import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN, API_URL, DEFAULT_NAME, DEFAULT_THEME_COLOURS } from "./support-constants";

export { ADMIN, API_URL, DEFAULT_NAME, DEFAULT_THEME_COLOURS };
const WEB_URL = process.env.WEB_URL ?? "http://localhost:8080";
const ALLOWED_ORIGINS = new Set([new URL(WEB_URL).origin, new URL(API_URL).origin]);
export const TOKEN_KEY = "jobproof.token";

export const MANAGER = { email: "manager@jobproof.test", password: "Manager123!", name: "Sarah Whitfield" };
export const MANAGER2 = { email: "manager2@jobproof.test", password: "Manager123!", name: "Priya Nair" };
export const PAINTER = { email: "painter@jobproof.test", password: "Painter123!", name: "Dan Hughes" };

/**
 * Every test fails if the browser requests any origin other than the web app and the API
 * (ticket T-001d scenario 10: runs offline).
 */
export const test = base.extend<{ origins: string[] }>({
  origins: [
    async ({ context }, use) => {
      const seen = new Set<string>();
      // context-level, so popups, new pages and service workers are covered too
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol === "http:" || url.protocol === "https:") seen.add(url.origin);
      });
      await use([]);
      const external = [...seen].filter((o) => !ALLOWED_ORIGINS.has(o));
      expect(external, "requests to origins other than the web app and API").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function apiToken(request: APIRequestContext, who = MANAGER): Promise<string> {
  const res = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: who.email, password: who.password },
  });
  expect(res.ok(), "API login").toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** GET a manager endpoint directly, so the UI is checked against live data. */
export class ManagerApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  static async create(request: APIRequestContext): Promise<ManagerApi> {
    return new ManagerApi(request, await apiToken(request));
  }

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
    const res = await this.request.get(`${API_URL}/api/v1/manager/${path}${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    expect(res.ok(), `GET ${path}`).toBe(true);
    return (await res.json()) as T;
  }

  /** All reports (the seed has 60), newest first. */
  async allReports(): Promise<ReportItem[]> {
    const page = await this.get<{ items: ReportItem[] }>("reports", { page_size: 100 });
    return page.items;
  }
}

export interface ReportItem {
  id: string;
  job_reference: string;
  customer: { id: string; name: string };
  site_address: { line1: string; town: string; postcode: string };
  painter: { id: string; name: string };
  completed_on: string;
  photo_count: number;
  review_status: string;
  billing_status: string;
}

export interface Page_<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** Signs in through the API and seeds the session token before the app loads. */
export async function signInViaApi(page: Page, who = MANAGER): Promise<string> {
  const token = await apiToken(page.request, who);
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("e2e-seeded")) {
        sessionStorage.setItem("e2e-seeded", "1");
        sessionStorage.setItem(key, value);
      }
    },
    [TOKEN_KEY, token],
  );
  return token;
}

export function showing(page: number, total: number, size: number, noun: string): string {
  if (total === 0) return `${total} ${noun}`;
  const start = (page - 1) * size + 1;
  const end = Math.min(page * size, total);
  return `Showing ${start}-${end} of ${total} ${noun}`;
}

/** GBP formatting written independently of the app's formatter. */
export function gbp(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

export async function expectMainHasText(page: Page): Promise<void> {
  const text = await page.locator("main").first().innerText();
  expect(text.trim().length, "main landmark has visible text").toBeGreaterThan(0);
}

/** Cursor-free check that nothing overflows the viewport sideways. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal page overflow in px").toBeLessThanOrEqual(0);
}

export interface Branding {
  company_name: string;
  theme: { primary: string; accent: string; background: string; surface: string; text: string };
}

export async function getBranding(request: APIRequestContext): Promise<Branding> {
  const res = await request.get(`${API_URL}/api/v1/branding`);
  expect(res.ok(), "GET /branding").toBe(true);
  return (await res.json()) as Branding;
}

/** Admin PATCH straight to the API (used to set up and restore settings). */
export async function patchSettings(request: APIRequestContext, data: Record<string, unknown>) {
  const token = await apiToken(request, ADMIN);
  return request.patch(`${API_URL}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${token}` }, data });
}

export async function restoreDefaultSettings(request: APIRequestContext): Promise<void> {
  const res = await patchSettings(request, { company_name: DEFAULT_NAME, theme: DEFAULT_THEME_COLOURS });
  expect(res.ok(), "restoring default settings").toBe(true);
}

/** Contrast helpers written independently of the app, for checking computed colours. */
export function parseRgb(css: string): [number, number, number] {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (!m) throw new Error(`not an rgb colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export async function expectNoContrastViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  const summary = results.violations.flatMap((v) => v.nodes.map((n) => `${label}: ${v.id} ${n.target.join(" ")} ${n.any[0]?.message ?? ""}`));
  expect(summary, `color-contrast violations on ${label}`).toEqual([]);
}
