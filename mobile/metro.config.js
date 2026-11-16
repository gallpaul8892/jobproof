// Expo's default config already watches the npm workspace root (monorepo support).
// The repo keeps ONE copy of react (root overrides pin 19.3.0, which is what React Native 0.88's
// renderer is built for); mobile/test/singleReact.test.ts fails if a second copy appears (design R4).
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// GitHub Pages demo (JOBPROOF_DEMO=1 `expo export --platform web`): a browser build whose native
// modules and server are replaced by in-memory stand-ins from mobile/demo. Every redirect below is
// limited to platform "web" AND the env switch, so the Android app (and any other build) resolves
// exactly the modules it always did. mobile/demo/checkDemoBundle.mjs verifies this after a build.
if (process.env.JOBPROOF_DEMO === "1") {
  const demo = (file) => path.join(__dirname, "demo", file);
  const srcOpenStore = path.join(__dirname, "src", "db", "openStore");
  const byName = {
    "expo-sqlite/kv-store": demo("shims/kvStore.ts"),
    "expo-secure-store": demo("shims/secureStore.ts"),
    "expo-camera": demo("shims/camera.tsx"),
  };
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const next = () => (upstream ?? context.resolveRequest)(context, moduleName, platform);
    if (platform !== "web") return next();
    if (byName[moduleName]) return { type: "sourceFile", filePath: byName[moduleName] };
    const origin = context.originModulePath ?? "";
    if (moduleName.startsWith(".") && path.resolve(path.dirname(origin), moduleName) === srcOpenStore) {
      return { type: "sourceFile", filePath: demo("shims/openStore.ts") };
    }
    // react-native-web draws a Modal into document.body; the demo draws it inside the phone frame.
    if (moduleName === "./ModalPortal" && origin.includes(`react-native-web${path.sep}dist${path.sep}exports${path.sep}Modal`)) {
      return { type: "sourceFile", filePath: demo("shims/ModalPortal.tsx") };
    }
    // Links that only a phone can follow (geo:, tel:) fail with the app's own message instead of a blank tab.
    // babel-preset-expo rewrites `import { Linking } from "react-native"` to this deep import; the shim itself
    // must still reach the real one. `./exports/Linking` is the same module seen from react-native-web's own index.
    const linkingShim = demo("shims/Linking.ts");
    if (moduleName === "react-native-web/dist/exports/Linking" && origin !== linkingShim) {
      return { type: "sourceFile", filePath: linkingShim };
    }
    if (moduleName === "./exports/Linking" && origin.endsWith(`react-native-web${path.sep}dist${path.sep}index.js`)) {
      return { type: "sourceFile", filePath: linkingShim };
    }
    return next();
  };
}

module.exports = config;
