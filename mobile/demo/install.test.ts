/** @jest-environment jsdom */
import { DEMO_MARKER, installDemo } from "./install";

// jsdom has no structuredClone; every browser the demo targets does.
globalThis.structuredClone ??= (v: unknown) => JSON.parse(JSON.stringify(v));

describe("installDemo", () => {
  it("switches the demo on once: frame, marker, title and a replacement fetch", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const before = jest.fn();
    globalThis.fetch = before as unknown as typeof fetch;
    const backend = installDemo({ home: "/jobproof/" });
    expect(backend).toBeDefined();
    expect((window as unknown as Record<string, unknown>)[DEMO_MARKER]).toBe(true);
    expect(globalThis.fetch).not.toBe(before);
    expect(document.title).toMatch(/demo/i);
    expect(document.querySelector('[data-testid="demo-home-link"]')!.getAttribute("href")).toBe("/jobproof/");
    const panel = document.querySelector('[data-testid="demo-logins"]')!.textContent!;
    for (const who of ["Dan Hughes", "Priya Shah", "Tom Bennett", "priya.shah@jobproof.test", "Painter123!"]) expect(panel).toContain(who);
    expect(document.querySelectorAll('[data-testid^="demo-use-login-"]')).toHaveLength(3);
    expect(installDemo({ home: "/other/" })).toBeUndefined(); // a second call does nothing
    expect(document.querySelectorAll('[data-testid="demo-note"]')).toHaveLength(1);
  });
});
