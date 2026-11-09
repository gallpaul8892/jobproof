import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const files = ["app", "src"].flatMap((d) => sources(path.join(ROOT, d)));

describe("source scans", () => {
  it("covers the app sources", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("never says 'painter' in app or src (scenario 8)", () => {
    const offences = files.filter((f) => /painter/i.test(fs.readFileSync(f, "utf8")));
    expect(offences).toEqual([]);
  });

  it("holds no http(s) address literal in src (scenario 6)", () => {
    const offences = files.filter((f) => /https?:\/\//i.test(fs.readFileSync(f, "utf8")));
    expect(offences).toEqual([]);
  });

  it("holds no default theme colour or company name outside shared defaults", () => {
    const offences = files.filter((f) => /#[0-9a-f]{6}\b|arbour/i.test(fs.readFileSync(f, "utf8")));
    expect(offences).toEqual([]);
  });

  it("imports the shared package only through its public entry (scenario 5)", () => {
    const offences = files.filter((f) => /@jobproof\/shared\/|shared\/src/.test(fs.readFileSync(f, "utf8")));
    expect(offences).toEqual([]);
  });
});

describe("token hygiene (scenario 6)", () => {
  const read = (f: string) => fs.readFileSync(f, "utf8");

  it("never logs anything that mentions a token", () => {
    const offences = files.filter((f) => /console\.\w+\([^)]*token/i.test(read(f)) || /console\.\w+\([^)]*password/i.test(read(f)));
    expect(offences).toEqual([]);
  });

  it("only SecureTokenStore imports expo-secure-store", () => {
    const users = files.filter((f) => /from "expo-secure-store"/.test(read(f))).map((f) => path.relative(ROOT, f));
    expect(users).toEqual([path.join("src", "api", "secureTokenStore.ts")]);
  });

  it("the plain key-value store never receives a credential", () => {
    const kv = files.filter((f) => /expo-sqlite\/kv-store/.test(read(f)));
    expect(kv.length).toBeGreaterThan(0);
    for (const f of kv) expect(read(f)).not.toMatch(/token|password|refresh/i);
  });
});
