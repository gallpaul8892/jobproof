/**
 * Semantic version `major.minor.patch`, exactly the contract's SemVer
 * (api/openapi.yaml `^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$`) and backend/app/versioning.py:
 * no prerelease, no build metadata, one to four digits per part, no trimming.
 * The case table `semverCases.json` is read by this twin's Vitest and by
 * backend/tests/test_semver_cases.py so the two cannot drift.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER = /^([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})$/;

/** Parses "1.2.3"; returns null when it is not a contract SemVer. */
export function parseSemver(version: string): SemVer | null {
  const m = SEMVER.exec(version);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** -1, 0 or 1. Throws on an invalid version string. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Invalid semver: ${pa ? b : a}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return 0;
}

/** True when `version` is older than `minimum`. An unparseable version counts as unsupported. */
export function isBelowMinimum(version: string, minimum: string): boolean {
  if (!parseSemver(version)) return true;
  if (!parseSemver(minimum)) return false;
  return compareSemver(version, minimum) < 0;
}
