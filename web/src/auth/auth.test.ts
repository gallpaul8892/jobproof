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
  it("accepts only same-site absolute paths", () => {
    expect(safeRedirect("/billing")).toBe("/billing");
    expect(safeRedirect("/reports?page=2")).toBe("/reports?page=2");
    for (const bad of [null, "", "billing", "//evil.com", "/\\evil.com", "https://evil.com", "/login"]) {
      expect(safeRedirect(bad)).toBe("/");
    }
  });

  it("builds login URLs", () => {
    expect(loginUrl("/billing")).toBe("/login?from=%2Fbilling");
    expect(loginUrl("/", true)).toBe("/login?expired=1");
    expect(loginUrl("/reports?page=2", true)).toBe("/login?from=%2Freports%3Fpage%3D2&expired=1");
    expect(loginUrl("/login?expired=1", true)).toBe("/login?expired=1");
  });
});
