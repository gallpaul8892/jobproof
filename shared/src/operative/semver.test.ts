import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareSemver, isBelowMinimum, parseSemver } from "./semver";

interface Cases {
  parse: { input: string; ok: boolean; parts?: [number, number, number] }[];
  older: { version: string; minimum: string; older: boolean }[];
}

// The same file backend/tests/test_semver_cases.py reads, so the two twins cannot drift.
const CASES = JSON.parse(readFileSync(new URL("./semverCases.json", import.meta.url), "utf8")) as Cases;

describe("semver against the shared case table", () => {
  it("has a useful table", () => {
    expect(CASES.parse.length).toBeGreaterThanOrEqual(20);
    expect(CASES.parse.some((c) => c.ok)).toBe(true);
    expect(CASES.parse.some((c) => !c.ok)).toBe(true);
  });

  it.each(CASES.parse.map((c) => [JSON.stringify(c.input), c] as const))("parse %s", (_name, c) => {
    const parsed = parseSemver(c.input);
    if (c.ok) {
      expect(parsed).toEqual({ major: c.parts![0], minor: c.parts![1], patch: c.parts![2] });
    } else {
      expect(parsed).toBeNull();
    }
  });

  it.each(CASES.older.map((c) => [`${c.version} vs ${c.minimum}`, c] as const))("older %s", (_name, c) => {
    expect(isBelowMinimum(c.version, c.minimum)).toBe(c.older);
  });
});

describe("semver helpers", () => {
  it("compares numerically, not as strings", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("0.9.9", "1.0.0")).toBe(-1);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
    expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
  });

  it("throws on invalid input", () => {
    expect(() => compareSemver("x", "1.0.0")).toThrow();
    expect(() => compareSemver("1.0.0", "1.0.0-rc.1")).toThrow();
  });

  it("an unparseable version counts as unsupported, an unparseable minimum as no minimum", () => {
    expect(isBelowMinimum("garbage", "1.0.0")).toBe(true);
    expect(isBelowMinimum("1.0.0", "garbage")).toBe(false);
  });
});
