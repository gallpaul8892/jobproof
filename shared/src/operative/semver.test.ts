import { describe, expect, it } from "vitest";
import { compareSemver, isBelowMinimum, parseSemver } from "./semver";

describe("semver", () => {
  it("parses valid versions and rejects invalid ones", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseSemver("1.2.3-rc.1+b5")).toMatchObject({ prerelease: "rc.1" });
    for (const bad of ["1.2", "01.2.3", "a.b.c", "", "1.2.3.4", "v1.2.3"]) expect(parseSemver(bad)).toBeNull();
  });

  it("compares numerically, not as strings", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("0.9.9", "1.0.0")).toBe(-1);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
    expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
  });

  it("ranks prereleases below the release and orders their identifiers", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });

  it("throws on invalid input", () => {
    expect(() => compareSemver("x", "1.0.0")).toThrow();
  });

  it("isBelowMinimum", () => {
    expect(isBelowMinimum("0.1.0", "0.0.0")).toBe(false);
    expect(isBelowMinimum("0.1.0", "0.2.0")).toBe(true);
    expect(isBelowMinimum("1.0.0", "1.0.0")).toBe(false);
    expect(isBelowMinimum("garbage", "1.0.0")).toBe(true);
  });
});
