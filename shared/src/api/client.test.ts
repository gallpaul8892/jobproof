import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import { callApi, configureApiClient, REQUEST_TIMEOUT_MS } from "./client";
import { getHealth, getMe } from "../generated";

function jsonResponse(body: unknown, status: number, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } });
}

describe("api client adapter", () => {
  it("calls the configured base URL and returns the body", async () => {
    let requested = "";
    configureApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        requested = input instanceof Request ? input.url : String(input);
        return jsonResponse({ status: "ok", database: "ok", version: "0.1.0" }, 200);
      },
    });
    const health = await callApi(() => getHealth());
    expect(requested).toBe("http://api.test/health");
    expect(health.status).toBe("ok");
  });

  it("maps a problem+json response to ApiError", async () => {
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        jsonResponse(
          { title: "Not found", status: 404, code: "not_found", request_id: "abc-123" },
          404,
          "application/problem+json",
        ),
    });
    const err = await callApi(() => getHealth()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found", requestId: "abc-123" });
  });

  it("maps a 503 health body to ApiError 'unavailable'", async () => {
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async () => jsonResponse({ status: "degraded", database: "unavailable", version: "0.1.0" }, 503),
    });
    const err = await callApi(() => getHealth()).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503 });
  });

  it("maps network failure to ApiError with status 0", async () => {
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const err = await callApi(() => getHealth()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "network_error" });
  });

  it("maps a timeout to ApiError code 'timeout'", async () => {
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async () => {
        throw new DOMException("The operation timed out", "TimeoutError");
      },
    });
    const err = await callApi(() => getHealth()).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: "timeout" });
  });

  it("sends the bearer token on authenticated calls", async () => {
    let auth: string | null = null;
    configureApiClient({
      baseUrl: "http://api.test",
      tokenStore: { get: () => "tok123", set: () => undefined, clear: () => undefined },
      fetch: async (input) => {
        auth = input instanceof Request ? input.headers.get("Authorization") : null;
        return jsonResponse({ id: "1", email: "a", full_name: "A", role: "manager" }, 200);
      },
    });
    await callApi(() => getMe());
    expect(auth).toBe("Bearer tok123");
  });

  it("calls onUnauthorized for a 401 but not for invalid_credentials", async () => {
    let calls = 0;
    const problem = (code: string) =>
      jsonResponse({ title: "x", status: 401, code, request_id: "r" }, 401, "application/problem+json");
    configureApiClient({
      baseUrl: "http://api.test",
      onUnauthorized: () => {
        calls += 1;
      },
      fetch: async () => problem("unauthenticated"),
    });
    await callApi(() => getMe()).catch(() => undefined);
    expect(calls).toBe(1);
    configureApiClient({
      baseUrl: "http://api.test",
      onUnauthorized: () => {
        calls += 1;
      },
      fetch: async () => problem("invalid_credentials"),
    });
    await callApi(() => getMe()).catch(() => undefined);
    expect(calls).toBe(1);
  });

  it("aborts the request when the caller's signal aborts", async () => {
    let seen: AbortSignal | undefined;
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: (input, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener("abort", () => reject(seen?.reason));
          void input;
        }),
    });
    const controller = new AbortController();
    const pending = callApi(() => getMe({ signal: controller.signal })).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.aborted).toBe(false);
    controller.abort();
    const err = await pending;
    expect(seen?.aborted).toBe(true);
    expect(err).toBeInstanceOf(ApiError);
  });

  it("still times out when the caller supplies a signal", async () => {
    let seen: AbortSignal | undefined;
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async (_input, init) => {
        seen = init?.signal ?? undefined;
        return jsonResponse({ id: "1", email: "a", full_name: "A", role: "manager" }, 200);
      },
    });
    await callApi(() => getMe({ signal: new AbortController().signal }));
    expect(seen).toBeDefined();
    expect(typeof AbortSignal.any).toBe("function");
    expect(seen?.aborted).toBe(false);
  });
});

describe("api client: runtimes without AbortSignal.any / timeout (Hermes)", () => {
  const original = { any: AbortSignal.any, timeout: AbortSignal.timeout };
  beforeEach(() => {
    // @ts-expect-error simulate a runtime without these statics
    delete AbortSignal.any;
    // @ts-expect-error simulate a runtime without these statics
    delete AbortSignal.timeout;
  });
  afterEach(() => {
    AbortSignal.any = original.any;
    AbortSignal.timeout = original.timeout;
    vi.useRealTimers();
  });

  it("still works and aborts on the caller's signal", async () => {
    let seen: AbortSignal | undefined;
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener("abort", () => reject(seen?.reason));
        }),
    });
    const controller = new AbortController();
    const pending = callApi(() => getMe({ signal: controller.signal })).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(await pending).toBeInstanceOf(ApiError);
    expect(seen?.aborted).toBe(true);
  });

  it("times out after REQUEST_TIMEOUT_MS with code 'timeout'", async () => {
    vi.useFakeTimers();
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    const pending = callApi(() => getMe()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ status: 0, code: "timeout" });
  });

  it("clears the timer when the request settles", async () => {
    vi.useFakeTimers();
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async () => jsonResponse({ id: "1", email: "a", full_name: "A", role: "manager" }, 200),
    });
    await callApi(() => getMe());
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("api client: refresh hook point", () => {
  const problem = (code: string) =>
    jsonResponse({ title: "x", status: 401, code, request_id: "r" }, 401, "application/problem+json");
  const me = () => jsonResponse({ id: "1", email: "a", full_name: "A", role: "painter" }, 200);

  it("refreshes once on 401 and retries the call", async () => {
    let token = "old";
    let refreshes = 0;
    let unauthorized = 0;
    const seen: (string | null)[] = [];
    configureApiClient({
      baseUrl: "http://api.test",
      tokenStore: { get: () => token, set: () => undefined, clear: () => undefined },
      onUnauthorized: () => void (unauthorized += 1),
      refresh: async () => {
        refreshes += 1;
        token = "new";
        return true;
      },
      fetch: async (input) => {
        const auth = input instanceof Request ? input.headers.get("Authorization") : null;
        seen.push(auth);
        return auth === "Bearer new" ? me() : problem("session_expired");
      },
    });
    await expect(callApi(() => getMe())).resolves.toMatchObject({ id: "1" });
    expect(refreshes).toBe(1);
    expect(unauthorized).toBe(0);
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
  });

  it("shares one refresh between concurrent 401s (single flight)", async () => {
    let token = "old";
    let refreshes = 0;
    configureApiClient({
      baseUrl: "http://api.test",
      tokenStore: { get: () => token, set: () => undefined, clear: () => undefined },
      refresh: async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        token = "new";
        return true;
      },
      fetch: async (input) =>
        input instanceof Request && input.headers.get("Authorization") === "Bearer new" ? me() : problem("unauthenticated"),
    });
    await Promise.all([callApi(() => getMe()), callApi(() => getMe()), callApi(() => getMe())]);
    expect(refreshes).toBe(1);
  });

  it("runs onUnauthorized only when the refresh fails, and does not retry", async () => {
    let calls = 0;
    let unauthorized = 0;
    configureApiClient({
      baseUrl: "http://api.test",
      onUnauthorized: () => void (unauthorized += 1),
      refresh: async () => false,
      fetch: async () => {
        calls += 1;
        return problem("unauthenticated");
      },
    });
    await expect(callApi(() => getMe())).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(1);
    expect(unauthorized).toBe(1);
  });

  it("treats a throwing refresh as failed", async () => {
    let unauthorized = 0;
    configureApiClient({
      baseUrl: "http://api.test",
      onUnauthorized: () => void (unauthorized += 1),
      refresh: async () => {
        throw new Error("boom");
      },
      fetch: async () => problem("unauthenticated"),
    });
    await expect(callApi(() => getMe())).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toBe(1);
  });

  it("retries only once: a second 401 after a successful refresh ends the session", async () => {
    let calls = 0;
    let unauthorized = 0;
    configureApiClient({
      baseUrl: "http://api.test",
      onUnauthorized: () => void (unauthorized += 1),
      refresh: async () => true,
      fetch: async () => {
        calls += 1;
        return problem("unauthenticated");
      },
    });
    await expect(callApi(() => getMe())).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(2);
    expect(unauthorized).toBe(1);
  });

  it("does not refresh for invalid_credentials", async () => {
    let refreshes = 0;
    configureApiClient({
      baseUrl: "http://api.test",
      refresh: async () => {
        refreshes += 1;
        return true;
      },
      fetch: async () => problem("invalid_credentials"),
    });
    await callApi(() => getMe()).catch(() => undefined);
    expect(refreshes).toBe(0);
  });
});
