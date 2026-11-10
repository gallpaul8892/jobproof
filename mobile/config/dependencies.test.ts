import fs from "node:fs";
import path from "node:path";

// Native modules must sit at the version the Expo SDK bundles (npx expo install --check would say the same).
describe("Expo-bundled native modules", () => {
  const root = path.resolve(__dirname, "../..");
  const bundled = JSON.parse(fs.readFileSync(path.join(root, "node_modules/expo/bundledNativeModules.json"), "utf8")) as Record<string, string>;
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as { dependencies: Record<string, string> };

  it.each(["expo-secure-store", "expo-splash-screen", "expo-sqlite", "expo-router", "expo-camera", "expo-image-picker", "expo-image-manipulator", "expo-file-system"])("%s matches the SDK", (name) => {
    expect(pkg.dependencies[name]).toBe(bundled[name]);
  });
});

// T-003e scenario 13 / P6: nothing in the app may reach the phone's gallery.
describe("photos never reach the phone's gallery", () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as { dependencies: Record<string, string> };
  it("expo-media-library is not a dependency", () => {
    expect(pkgJson.dependencies["expo-media-library"]).toBeUndefined();
  });
  it("no source file imports it (the lint rule says the same)", () => {
    const root = path.resolve(__dirname, "..");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "coverage" || e.name === "dist" || e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !full.endsWith("dependencies.test.ts") && fs.readFileSync(full, "utf8").includes("expo-media-library")) found.push(full);
      }
    };
    for (const d of ["app", "src"]) walk(path.join(root, d));
    expect(found).toEqual([]);
  });
});
