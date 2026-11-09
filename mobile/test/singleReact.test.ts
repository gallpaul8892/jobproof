import { createRequire } from "node:module";
import path from "node:path";

// Design R4: one React copy for shared, web and mobile (React Native's renderer is built for one exact version).
describe("one React copy", () => {
  const roots = ["mobile", "shared", "web"].map((d) => path.resolve(__dirname, "../..", d, "package.json"));

  it("resolves the same react and react-dom from mobile, shared and web", () => {
    for (const name of ["react", "react-dom", "react/jsx-runtime"]) {
      const resolved = new Set(roots.map((r) => createRequire(r).resolve(name)));
      expect([...resolved]).toHaveLength(1);
    }
  });

  it("is the exact version the React Native renderer is built for", () => {
    const rnRequire = createRequire(require.resolve("react-native/package.json"));
    const react = rnRequire("react/package.json") as { version: string };
    expect(react.version).toBe("19.3.0");
  });
});
