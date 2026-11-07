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
    files: ["**/scripts/*.mjs", "*.js", "e2e/**/*.ts", "web/vite.config.ts", "shared/*.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
