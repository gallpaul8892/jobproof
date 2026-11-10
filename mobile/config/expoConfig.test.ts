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
    ) as { android: { allowBackup: boolean; package: string; blockedPermissions: string[] }; extra: { apiBaseUrl: string }; plugins: unknown[] };

  it("resolves to the secure Android baseline", () => {
    const c = run({ API_BASE_URL: "https://api.example.test", APP_VARIANT: "production" });
    expect(c.android.allowBackup).toBe(false);
    expect(c.android.package).toBe("uk.co.jobproof.operative");
    expect(c.android.blockedPermissions).toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
    expect(c.extra.apiBaseUrl).toBe("https://api.example.test");
  }, 60_000);

  it("blocks every media and microphone permission but not the camera (T-003e scenario 13, design 12)", () => {
    const c = run({ API_BASE_URL: "https://api.example.test", APP_VARIANT: "production" });
    for (const p of ["RECORD_AUDIO", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_MEDIA_VISUAL_USER_SELECTED", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "ACCESS_MEDIA_LOCATION"]) {
      expect(c.android.blockedPermissions).toContain(`android.permission.${p}`);
    }
    expect(c.android.blockedPermissions).not.toContain("android.permission.CAMERA");
  }, 60_000);

  it("configures expo-camera without audio and the image picker without a microphone", () => {
    const c = run({ API_BASE_URL: "https://api.example.test", APP_VARIANT: "production" });
    const options = (name: string) => (c.plugins.find((p) => Array.isArray(p) && p[0] === name) as [string, Record<string, unknown>] | undefined)?.[1];
    expect(options("expo-camera")).toMatchObject({ recordAudioAndroid: false });
    expect(options("expo-image-picker")).toMatchObject({ microphonePermission: false });
    expect(options("expo-image-picker")?.cameraPermission).toBeUndefined(); // false would block CAMERA
  }, 60_000);
});
