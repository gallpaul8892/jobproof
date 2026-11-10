import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "backend/**",
      "mobile/.expo/**",
      "mobile/android/**",
      "mobile/ios/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}", "web/public/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["web/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["mobile/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: { ...globals.node, ...globals.jest, __DEV__: "readonly" } },
  },
  {
    // T-003b scenario 6: nothing named *token* or *password* may reach a log call.
    files: ["mobile/app/**/*.{ts,tsx}", "mobile/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='console'] :matches(Identifier[name=/token|password|secret/i])",
          message: "Do not log credentials: nothing named token, password or secret may reach console.",
        },
      ],
    },
  },
  {
    files: ["mobile/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" }, // Metro/Jest configs are CommonJS
  },
  {
    // Scenario 5: mobile reaches the shared package only through its public entry.
    files: ["mobile/app/**/*.{ts,tsx}", "mobile/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            // T-003e scenario 13 / P6: photos live in app-private storage only, never in the phone's gallery.
            { name: "expo-media-library", message: "Photos must never be written to the phone's gallery (P6). Use app-private files." },
          ],
          patterns: [
            { group: ["@jobproof/shared/*", "**/shared/src/**", "**/generated/**"], message: "Import from @jobproof/shared only." },
          ],
        },
      ],
    },
  },
  {
    files: ["**/scripts/*.mjs", "*.js", "mobile/*.js", "mobile/*.ts", "mobile/config/**/*.ts", "mobile/test/**/*.ts", "e2e/**/*.ts", "web/vite.config.ts", "shared/*.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
