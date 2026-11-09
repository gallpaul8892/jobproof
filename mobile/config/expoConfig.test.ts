import { execFileSync } from "node:child_process";
import path from "node:path";

// The real Expo CLI evaluating app.config.ts, as the build does (design section 9, "Config").
describe("npx expo config --type public", () => {
  const run = (env: Record<string, string>) =>
    JSON.parse(
      execFileSync("npx", ["expo", "config", "--type", "public", "--json"], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, EXPO_OFFLINE: "1", ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ) as { android: { allowBackup: boolean; package: string; blockedPermissions: string[] }; extra: { apiBaseUrl: string } };

  it("resolves to the secure Android baseline", () => {
    const c = run({ API_BASE_URL: "https://api.example.test", APP_VARIANT: "production" });
    expect(c.android.allowBackup).toBe(false);
    expect(c.android.package).toBe("uk.co.jobproof.operative");
    expect(c.android.blockedPermissions).toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
    expect(c.extra.apiBaseUrl).toBe("https://api.example.test");
  }, 60_000);
});
