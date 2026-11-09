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
