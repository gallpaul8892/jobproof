import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 8080, strictPort: true, host: "0.0.0.0" },
  preview: { port: 8080, strictPort: true, host: "0.0.0.0" },
  build: { target: "es2022", sourcemap: false },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "nginx/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 60_000,
  },
});
