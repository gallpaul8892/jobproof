import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}

describe("the browser demo stays out of the real app", () => {
  it("nothing in app/ or src/ imports from demo/", () => {
    const offenders = ["app", "src"]
      .flatMap((d) => files(path.join(ROOT, d)))
      .filter((f) => /\.(ts|tsx|js)$/.test(f))
      .filter((f) => /from\s+["'][^"']*\/demo\/|require\(["'][^"']*\/demo\//.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the demo switch is read only by the Metro and Expo configs, never by app code", () => {
    const users = ["app", "src"]
      .flatMap((d) => files(path.join(ROOT, d)))
      .filter((f) => /\.(ts|tsx|js)$/.test(f))
      .filter((f) => fs.readFileSync(f, "utf8").includes("JOBPROOF_DEMO"))
      .map((f) => path.relative(ROOT, f));
    expect(users).toEqual([]);
    for (const f of ["metro.config.js", "app.config.ts"]) expect(fs.readFileSync(path.join(ROOT, f), "utf8")).toContain("JOBPROOF_DEMO");
  });

  it("the demo is not part of the app's package files or its Expo plugins", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { main: string; dependencies: Record<string, string> };
    expect(pkg.main).toBe("expo-router/entry"); // the native entry point is unchanged
    expect(Object.keys(pkg.dependencies)).not.toContain("react-native-web"); // build-only, so a devDependency
  });
});
