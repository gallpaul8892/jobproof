/** Minimal semver (major.minor.patch, optional -prerelease/+build ignored for ordering of releases). */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses "1.2.3" (optionally "-rc.1", "+build"); returns null when it is not valid semver. */
export function parseSemver(version: string): SemVer | null {
  const m = SEMVER.exec(version.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // a release is higher than any of its prereleases
  if (b === null) return -1;
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (nx !== ny) {
      return nx ? -1 : 1; // numeric identifiers sort before alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** -1, 0 or 1. Throws on an invalid version string. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Invalid semver: ${pa ? b : a}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease) as -1 | 0 | 1;
}

/** True when `version` is older than `minimum`. An unparseable version counts as unsupported. */
export function isBelowMinimum(version: string, minimum: string): boolean {
  if (!parseSemver(version)) return true;
  if (!parseSemver(minimum)) return false;
  return compareSemver(version, minimum) < 0;
}
