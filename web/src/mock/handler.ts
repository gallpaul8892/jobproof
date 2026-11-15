import type { LoginResponse, Role, User } from "@jobproof/shared";
import { MockProblem, type FieldIssue, type MockBackend, type ReportFilters } from "./backend";

/** Bearer tokens issued by the mock. They are not secrets: they only name a demo user. */
const TOKEN_PREFIX = "mock-token.";
const TOKEN_TTL_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENUMS = {
  review_status: ["awaiting_review", "reviewed"],
  billing_status: ["not_invoiced", "draft", "sent", "part_paid", "overdue", "paid", "void"],
  sort: ["default", "submitted_asc"],
  status: ["draft", "sent", "part_paid", "overdue", "paid", "void"],
} as const;

const issueToken = (user: User) => `${TOKEN_PREFIX}${user.id}`;

function problemResponse(status: number, code: string, title: string, extra: Record<string, unknown> = {}, errors?: FieldIssue[]): Response {
  const body = {
    type: "about:blank",
    title,
    detail: title,
    status,
    code,
    request_id: "mock",
    ...(errors ? { errors } : {}),
    ...extra,
  };
  const headers: Record<string, string> = { "Content-Type": "application/problem+json" };
  if (status === 401) headers["WWW-Authenticate"] = "Bearer";
  return new Response(JSON.stringify(body), { status, headers });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function queryErrors(params: URLSearchParams): { filters: ReportFilters; page: number; pageSize: number; errors: FieldIssue[] } {
  const errors: FieldIssue[] = [];
  const bad = (name: string, message: string) => errors.push({ loc: ["query", name], message });
  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!/^-?\d+$/.test(raw) || n < min || n > max) {
      bad(name, max < Number.MAX_SAFE_INTEGER ? `Input should be between ${min} and ${max}.` : `Input should be greater than or equal to ${min}.`);
      return fallback;
    }
    return n;
  };
  const page = int("page", 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = int("page_size", 20, 1, 100);
  const filters: ReportFilters = {};
  for (const key of ["review_status", "billing_status", "sort"] as const) {
    const v = params.get(key);
    if (v === null) continue;
    if ((ENUMS[key] as readonly string[]).includes(v)) filters[key] = v;
    else bad(key, `Input should be one of: ${ENUMS[key].join(", ")}.`);
  }
  for (const key of ["painter_id", "customer_id"] as const) {
    const v = params.get(key);
    if (v === null) continue;
    if (UUID.test(v)) filters[key] = v.toLowerCase();
    else bad(key, "Input should be a valid UUID.");
  }
  for (const key of ["date_from", "date_to"] as const) {
    const v = params.get(key);
    if (v === null) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) filters[key] = v;
    else bad(key, "Input should be a valid date.");
  }
  if (filters.date_from && filters.date_to && filters.date_to < filters.date_from) bad("date_to", "date_to must not be before date_from");
  const q = params.get("q");
  if (q !== null) {
    if (q.length < 1 || q.length > 100) bad("q", "String should have between 1 and 100 characters.");
    else if (q.includes("\u0000")) bad("q", "String should match the allowed pattern.");
    else if (q.trim() !== "") filters.q = q.trim();
  }
  return { filters, page, pageSize, errors };
}

/**
 * A `fetch` that answers the JobProof API from the in-memory mock backend. It speaks the same
 * HTTP-level contract as the real service: status codes, problem+json bodies, role checks.
 */
export function createMockFetch(backend: MockBackend): typeof fetch {
  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method.toUpperCase();
    const params = url.searchParams;

    const readBody = async (): Promise<unknown> => {
      const text = await request.text();
      if (text === "") throw new MockProblem(422, "validation_error", "Request validation failed.", {}, [{ loc: ["body"], message: "Field required." }]);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new MockProblem(422, "validation_error", "Request validation failed.", {}, [{ loc: ["body"], message: "Invalid JSON." }]);
      }
    };

    const allow = (...methods: string[]) => {
      if (!methods.includes(method)) throw new MockProblem(405, "not_found", "Method not allowed.");
    };

    // ---- public ----
    if (path === "/api/v1/auth/login") {
      allow("POST");
      const body = (await readBody()) as { email?: unknown; password?: unknown };
      if (typeof body?.email !== "string" || typeof body?.password !== "string") {
        throw new MockProblem(422, "validation_error", "Request validation failed.", {}, [
          { loc: ["body", typeof body?.email !== "string" ? "email" : "password"], message: "Input should be a valid string." },
        ]);
      }
      const user = backend.login(body.email, body.password);
      const result: LoginResponse = { access_token: issueToken(user), token_type: "bearer", expires_in: TOKEN_TTL_SECONDS, user };
      return json(result);
    }
    if (path === "/api/v1/auth/demo-accounts") {
      allow("GET");
      return json(backend.demoAccounts());
    }
    if (path === "/api/v1/branding") {
      allow("GET");
      return json(backend.branding(), 200, { "Cache-Control": "no-cache" });
    }

    // ---- authenticated ----
    const header = request.headers.get("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const user = token.startsWith(TOKEN_PREFIX) ? backend.userById(token.slice(TOKEN_PREFIX.length)) : null;
    if (!user) throw new MockProblem(401, "unauthenticated", "Sign in to continue.");
    const need = (role: Role) => {
      if (user.role !== role) throw new MockProblem(403, "forbidden", "You do not have access to this.");
    };

    if (path === "/api/v1/auth/me") {
      allow("GET");
      return json(user);
    }
    if (path === "/api/v1/auth/sessions/current") {
      return new Response(null, { status: 204 });
    }
    if (path === "/api/v1/admin/settings") {
      need("admin");
      allow("GET", "PATCH");
      return json(method === "GET" ? backend.adminSettings() : backend.updateAdminSettings(user, await readBody()));
    }
    if (path === "/api/v1/admin/settings/history") {
      need("admin");
      allow("GET");
      return json(backend.settingsHistory());
    }

    if (path.startsWith("/api/v1/manager/")) {
      need("manager");
      const rest = path.slice("/api/v1/manager/".length).split("/");
      const [resource, id, action] = rest;
      if (resource === "dashboard" && !id) {
        allow("GET");
        return json(backend.dashboard());
      }
      if (resource === "painters" && !id) {
        allow("GET");
        return json(backend.painters());
      }
      if (resource === "reports" && !id) {
        allow("GET");
        const q = queryErrors(params);
        if (q.errors.length > 0) throw new MockProblem(422, "validation_error", "Request validation failed.", {}, q.errors);
        return json(backend.listReports(q.filters, q.page, q.pageSize));
      }
      if (resource === "reports" && id && !action) {
        allow("GET", "PATCH");
        return json(method === "GET" ? backend.report(id) : backend.updateReport(user, id, await readBody()));
      }
      if (resource === "reports" && id && action === "review") {
        allow("POST");
        return json(backend.reviewReport(user, id, await readBody()));
      }
      if (resource === "reports" && id && action === "history") {
        allow("GET");
        return json(backend.reportHistory(id));
      }
      if (resource === "customers" && id && !action) {
        allow("GET", "PATCH");
        return json(method === "GET" ? backend.customer(id) : backend.updateCustomer(user, id, await readBody()));
      }
      if (resource === "customers" && id && action === "history") {
        allow("GET");
        return json(backend.customerHistory(id));
      }
      if (resource === "invoices" && !id) {
        allow("GET");
        const q = queryErrors(params);
        const status = params.get("status") ?? undefined;
        const errors = q.errors.filter((e) => e.loc[1] === "page" || e.loc[1] === "page_size");
        if (status !== undefined && !(ENUMS.status as readonly string[]).includes(status))
          errors.push({ loc: ["query", "status"], message: `Input should be one of: ${ENUMS.status.join(", ")}.` });
        if (errors.length > 0) throw new MockProblem(422, "validation_error", "Request validation failed.", {}, errors);
        return json(backend.listInvoices(status, q.page, q.pageSize));
      }
    }
    throw new MockProblem(404, "not_found", "Not found.");
  }

  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    // Answer asynchronously, like a network call, and honour an abort.
    await Promise.resolve();
    if (request.signal.aborted) throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof MockProblem) {
        return problemResponse(error.status, error.code, error.message, error.extensions, error.errors);
      }
      throw error;
    }
  };
}
