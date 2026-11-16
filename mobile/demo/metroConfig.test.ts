import path from "node:path";

type Resolution = { type: string; filePath?: string };
type Resolver = (context: { originModulePath?: string; resolveRequest: (...a: unknown[]) => Resolution }, name: string, platform: string | null) => Resolution;

const MOBILE = path.resolve(__dirname, "..");
const demo = (f: string) => path.join(MOBILE, "demo", f);

function load(env: string | undefined): { resolve: Resolver; upstream: jest.Mock } {
  const saved = process.env.JOBPROOF_DEMO;
  if (env === undefined) delete process.env.JOBPROOF_DEMO;
  else process.env.JOBPROOF_DEMO = env;
  try {
    let config: { resolver: { resolveRequest?: Resolver } } = { resolver: {} };
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro's config is CommonJS
      config = require("../metro.config.js");
    });
    const upstream = jest.fn(() => ({ type: "sourceFile", filePath: "upstream" }));
    const resolve: Resolver = (context, name, platform) => (config.resolver.resolveRequest ?? ((c, n, p) => c.resolveRequest(c, n, p) as Resolution))(context, name, platform);
    return { resolve: (c, n, p) => resolve({ ...c, resolveRequest: upstream }, n, p), upstream };
  } finally {
    if (saved === undefined) delete process.env.JOBPROOF_DEMO;
    else process.env.JOBPROOF_DEMO = saved;
  }
}

const ctx = (origin = path.join(MOBILE, "app", "_layout.tsx")) => ({ originModulePath: origin, resolveRequest: jest.fn() });

describe("metro.config.js", () => {
  it("without the switch it resolves exactly what Expo resolves: nothing is redirected", () => {
    const { resolve, upstream } = load(undefined);
    for (const platform of ["web", "android"]) {
      expect(resolve(ctx(), "expo-camera", platform).filePath).toBe("upstream");
      expect(resolve(ctx(), "../src/db/openStore", platform).filePath).toBe("upstream");
    }
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("with the switch, the Android build still resolves the real modules", () => {
    const { resolve } = load("1");
    for (const name of ["expo-camera", "expo-secure-store", "expo-sqlite/kv-store", "../src/db/openStore"]) {
      expect(resolve(ctx(), name, "android").filePath).toBe("upstream");
    }
  });

  it("with the switch, the web build swaps in the stand-ins", () => {
    const { resolve } = load("1");
    expect(resolve(ctx(), "expo-camera", "web").filePath).toBe(demo("shims/camera.tsx"));
    expect(resolve(ctx(), "expo-secure-store", "web").filePath).toBe(demo("shims/secureStore.ts"));
    expect(resolve(ctx(), "expo-sqlite/kv-store", "web").filePath).toBe(demo("shims/kvStore.ts"));
    expect(resolve(ctx(), "../src/db/openStore", "web").filePath).toBe(demo("shims/openStore.ts"));
    expect(resolve(ctx(path.join("x", "react-native-web", "dist", "exports", "Modal", "index.js")), "./ModalPortal", "web").filePath).toBe(demo("shims/ModalPortal.tsx"));
    expect(resolve(ctx(path.join("x", "react-native-web", "dist", "index.js")), "./exports/Linking", "web").filePath).toBe(demo("shims/Linking.ts"));
    // babel-preset-expo turns `import { Linking } from "react-native"` into this deep import; the shim's own import of it must not loop.
    expect(resolve(ctx(), "react-native-web/dist/exports/Linking", "web").filePath).toBe(demo("shims/Linking.ts"));
    expect(resolve(ctx(demo("shims/Linking.ts")), "react-native-web/dist/exports/Linking", "web").filePath).toBe("upstream");
  });

  it("only exact matches are redirected", () => {
    const { resolve } = load("1");
    expect(resolve(ctx(), "expo-camera/next", "web").filePath).toBe("upstream");
    expect(resolve(ctx(path.join(MOBILE, "src", "x.ts")), "./openStore", "web").filePath).toBe("upstream"); // a different folder
    expect(resolve(ctx(path.join("other", "index.js")), "./ModalPortal", "web").filePath).toBe("upstream");
    expect(resolve(ctx(path.join("other", "index.js")), "./exports/Linking", "web").filePath).toBe("upstream");
  });
});
