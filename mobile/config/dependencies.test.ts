import fs from "node:fs";
import path from "node:path";

// Native modules must sit at the version the Expo SDK bundles (npx expo install --check would say the same).
describe("Expo-bundled native modules", () => {
  const root = path.resolve(__dirname, "../..");
  const bundled = JSON.parse(fs.readFileSync(path.join(root, "node_modules/expo/bundledNativeModules.json"), "utf8")) as Record<string, string>;
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as { dependencies: Record<string, string> };

  it.each(["expo-secure-store", "expo-splash-screen", "expo-sqlite", "expo-router"])("%s matches the SDK", (name) => {
    expect(pkg.dependencies[name]).toBe(bundled[name]);
  });
});
