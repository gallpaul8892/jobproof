import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "./config";

describe("readRuntimeConfig", () => {
  it("returns apiBaseUrl from window.__JOBPROOF_CONFIG__", () => {
    const win = { __JOBPROOF_CONFIG__: { apiBaseUrl: " http://x:8000 " } } as unknown as Window;
    expect(readRuntimeConfig(win).apiBaseUrl).toBe("http://x:8000");
  });
  it("throws when config.js did not run", () => {
    expect(() => readRuntimeConfig({} as Window)).toThrow(/Missing runtime config/);
  });
});
