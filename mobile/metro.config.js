// Expo's default config already watches the npm workspace root (monorepo support).
// The repo keeps ONE copy of react (root overrides pin 19.3.0, which is what React Native 0.88's
// renderer is built for); mobile/test/singleReact.test.ts fails if a second copy appears (design R4).
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
