import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { configureApiClient } from "@jobproof/shared";
import { vi } from "vitest";
import { BrandingProvider } from "../theme/BrandingProvider";

export type Handler = (req: { method: string; path: string; body: unknown }) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

/** Routes the generated client's fetch calls to a handler; returns the recorded calls. */
export function mockApi(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const call = { method: request.method, path: url.pathname, body: text ? (JSON.parse(text) as unknown) : undefined };
    calls.push(call);
    const result = await handler(call);
    const status = result.status ?? 200;
    return new Response(JSON.stringify(result.body ?? {}), {
      status,
      headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
    });
  });
  configureApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock as unknown as typeof fetch,
    tokenStore: { get: () => "token", set: () => undefined, clear: () => undefined },
  });
  return calls;
}

export function renderApp(ui: ReactNode, { branding = false }: { branding?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = branding ? createElement(BrandingProvider, null, ui) : ui;
  return render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, tree)));
}

export const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  status,
  body: { type: "about:blank", title: "Problem", status, code, request_id: "t", ...extra },
});
