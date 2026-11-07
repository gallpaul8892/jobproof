import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

export const API_URL = process.env.API_URL ?? "http://localhost:8000";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:8080";
const ALLOWED_ORIGINS = new Set([new URL(WEB_URL).origin, new URL(API_URL).origin]);
export const TOKEN_KEY = "jobproof.token";

export const MANAGER = { email: "manager@jobproof.test", password: "Manager123!", name: "Sarah Whitfield" };
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
