import { describe, expect, it } from "vitest";
import { loginUrl, safeRedirect } from "./redirect";
import { createSessionTokenStore } from "./sessionTokenStore";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("session token store", () => {
  it("stores, reads and clears the token", () => {
    const store = createSessionTokenStore(fakeStorage());
    expect(store.get()).toBeNull();
    store.set("abc");
    expect(store.get()).toBe("abc");
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("keeps working in memory when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const store = createSessionTokenStore(broken);
    store.set("abc");
    expect(store.get()).toBe("abc");
    store.clear();
    expect(store.get()).toBeNull();
  });
});

describe("redirects", () => {
  const ORIGIN = "http://localhost:8080";

  it("accepts same-site paths", () => {
    expect(safeRedirect("/billing", ORIGIN)).toBe("/billing");
    expect(safeRedirect("/reports?page=2&q=a%20b", ORIGIN)).toBe("/reports?page=2&q=a%20b");
    expect(safeRedirect("/reports/abc#photos", ORIGIN)).toBe("/reports/abc#photos");
    expect(safeRedirect("/%09/example.com", ORIGIN)).toBe("/%09/example.com"); // literal, harmless path
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["relative path", "billing"],
    ["protocol-relative", "//evil.com"],
    ["slash backslash", "/\\evil.com"],
    ["backslash later", "/a\\b"],
    ["tab between slashes", "/\t/example.com"],
    ["LF between slashes", "/\n/example.com"],
    ["CR between slashes", "/\r/example.com"],
    ["tab then backslash", "/\t\\example.com"],
    ["NUL", "/a\u0000b"],
    ["unit separator", "/a\u001fb"],
    ["DEL", "/a\u007fb"],
    ["trailing newline", "/billing\n"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,x"],
    ["absolute other origin", "https://evil.com/x"],
    ["absolute same origin", "http://localhost:8080/billing"],
    ["login loop", "/login"],
    ["login with query", "/login?from=/billing"],
  ])("falls back to the dashboard for %s", (_name, value) => {
    expect(safeRedirect(value as string | null | undefined, ORIGIN)).toBe("/");
  });

  it("builds login URLs", () => {
    expect(loginUrl("/billing")).toBe("/login?from=%2Fbilling");
    expect(loginUrl("/", true)).toBe("/login?expired=1");
    expect(loginUrl("/reports?page=2", true)).toBe("/login?from=%2Freports%3Fpage%3D2&expired=1");
    expect(loginUrl("/login?expired=1", true)).toBe("/login?expired=1");
  });
});
