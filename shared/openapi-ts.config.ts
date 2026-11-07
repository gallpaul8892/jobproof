import { defineConfig } from "@hey-api/openapi-ts";

// Output is committed. Regenerate with `npm run gen` from the repo root.
export default defineConfig({
  input: "../api/openapi.yaml",
  output: "src/generated",
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    // baseUrl: false keeps the contract's `servers` URL out of the bundle; the base URL is
    // always set at runtime from config.js (see src/api/client.ts).
    { name: "@hey-api/client-fetch", baseUrl: false },
  ],
});
