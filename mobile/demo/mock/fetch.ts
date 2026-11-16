import { MockProblem, type OperativeBackend } from "./backend";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function problem(p: MockProblem): Response {
  const body = {
    type: "about:blank",
    title: p.message,
    detail: p.message,
    status: p.status,
    code: p.code,
    request_id: "demo",
    ...(p.errors ? { errors: p.errors } : {}),
    ...p.extra,
  };
  const headers: Record<string, string> = { "Content-Type": "application/problem+json" };
  if (p.status === 401) headers["WWW-Authenticate"] = "Bearer";
  return new Response(JSON.stringify(body), { status: p.status, headers });
}

/** Endpoints the real server will get in later tickets (T-003g, T-003h). The demo does not pretend to have them. */
const NOT_BUILT = [/^\/api\/v1\/operative\/jobs\/[^/]+\/report\/submit$/, /^\/api\/v1\/operative\/jobs\/[^/]+\/photos\/[^/]+(\/content)?$/];

/**
 * A `fetch` that answers the operative API from the in-memory backend, speaking the same HTTP
 * contract as the real service (status codes, problem+json, bearer auth). Requests that are not
 * for the API are never sent anywhere either: only same-origin requests pass to `passthrough`,
 * everything else fails like an offline network would.
 */
export function createDemoFetch(backend: OperativeBackend, passthrough?: typeof fetch): typeof fetch {
  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method.toUpperCase();
    const auth = request.headers.get("Authorization");
    const body = async (): Promise<unknown> => {
      const text = await request.text();
      try {
        return text === "" ? undefined : (JSON.parse(text) as unknown);
      } catch {
        throw new MockProblem(422, "validation_error", "Request validation failed.", [{ loc: ["body"], message: "Invalid JSON." }]);
      }
    };
    const only = (...methods: string[]) => {
      if (!methods.includes(method)) throw new MockProblem(405, "method_not_allowed", "Method not allowed.");
    };

    if (path === "/api/v1/branding") return only("GET"), json(backend.branding(), 200, { "Cache-Control": "no-cache" });
    if (path === "/api/v1/app/status") return only("GET"), json(backend.appStatus(), 200, { "Cache-Control": "no-store" });
    if (path === "/api/v1/auth/sessions") return only("POST"), json(backend.createSession(await body()), 201);
    if (path === "/api/v1/auth/sessions/refresh") return only("POST"), json(backend.refreshSession(await body()));
    if (path === "/api/v1/auth/sessions/current") {
      only("DELETE");
      backend.endSession(auth);
      return new Response(null, { status: 204 });
    }
    if (path === "/health" || path === "/health/live") return json({ status: "ok", database: "ok", version: "demo" });

    if (path.startsWith("/api/v1/operative/")) {
      if (NOT_BUILT.some((re) => re.test(path))) {
        backend.authenticate(auth);
        throw new MockProblem(404, "not_found", "This is not available in the demo.");
      }
      backend.authenticate(auth);
      if (path === "/api/v1/operative/jobs") return only("GET"), json(backend.listJobs());
      const report = /^\/api\/v1\/operative\/jobs\/([^/]+)\/report$/.exec(path);
      if (report) return only("PATCH"), json(backend.saveDraft(report[1]!, await body()));
      const one = /^\/api\/v1\/operative\/jobs\/([^/]+)$/.exec(path);
      if (one) return only("GET"), json(backend.getJob(one[1]!));
    }
    throw new MockProblem(404, "not_found", "Not found.");
  }

  return async (input, init) => {
    const request = input instanceof Request && !init ? input : new Request(input as RequestInfo | URL, init);
    const url = new URL(request.url, typeof location === "undefined" ? undefined : location.href);
    const sameOrigin = typeof location !== "undefined" && url.origin === location.origin;
    if (!url.pathname.startsWith("/api/v1/") && !url.pathname.startsWith("/health")) {
      // Not the API: same-origin assets may load, anything else behaves like no network.
      if (sameOrigin && passthrough) return passthrough(request);
      throw new TypeError("Failed to fetch");
    }
    if (request.signal.aborted) throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof MockProblem) return problem(error);
      throw error;
    }
  };
}
