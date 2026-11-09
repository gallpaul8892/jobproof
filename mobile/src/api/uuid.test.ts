import { randomUuid } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUuid", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  });

  it.each([
    ["crypto.randomUUID", { randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, /^a{8}-/],
    ["crypto.getRandomValues only", { getRandomValues: (a: Uint8Array) => a.fill(255) }, V4],
    ["no crypto at all (Hermes without it)", undefined, V4],
  ])("builds a version 4 UUID with %s", (_name, crypto, expected) => {
    Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
    expect(randomUuid()).toMatch(expected);
  });

  it("two calls differ", () => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    expect(randomUuid()).not.toBe(randomUuid());
  });
});
