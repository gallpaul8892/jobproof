import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { callApi, configureApiClient } from "./client";
import { getHealth } from "../generated";

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
});
