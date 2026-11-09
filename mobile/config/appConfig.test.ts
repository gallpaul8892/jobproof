import appConfig, { BLOCKED_PERMISSIONS, buildConfig } from "../app.config";

const ENV = { API_BASE_URL: "https://api.example.test", APP_VARIANT: "production" };

describe("app config", () => {
  it("throws without API_BASE_URL (scenario 6)", () => {
    expect(() => buildConfig({})).toThrow(/API_BASE_URL is required/);
    expect(() => buildConfig({ API_BASE_URL: "  " })).toThrow(/API_BASE_URL is required/);
  });

  it("app.config.ts reads the process environment", () => {
    const saved = process.env.API_BASE_URL;
    delete process.env.API_BASE_URL;
    try {
      expect(() => appConfig()).toThrow(/API_BASE_URL/);
    } finally {
      if (saved !== undefined) process.env.API_BASE_URL = saved;
    }
  });

  it("copies the address into extra without a trailing slash", () => {
    const c = buildConfig({ ...ENV, API_BASE_URL: "https://api.example.test/" });
    expect(c.extra).toEqual({ apiBaseUrl: "https://api.example.test", variant: "production" });
  });

  it("rejects a non-URL and an unknown variant", () => {
    expect(() => buildConfig({ ...ENV, API_BASE_URL: "not a url" })).toThrow(/absolute URL/);
    expect(() => buildConfig({ ...ENV, APP_VARIANT: "beta" })).toThrow(/APP_VARIANT/);
  });

  it("allows cleartext http only for the development variant", () => {
    expect(() => buildConfig({ API_BASE_URL: "http://10.0.2.2:8000", APP_VARIANT: "preview" })).toThrow(/https/);
    expect(() => buildConfig({ API_BASE_URL: "http://10.0.2.2:8000", APP_VARIANT: "production" })).toThrow(/https/);
    const dev = buildConfig({ API_BASE_URL: "http://10.0.2.2:8000", APP_VARIANT: "development" });
    const props = (dev.plugins as unknown[][]).find((p) => Array.isArray(p) && p[0] === "expo-build-properties")![1] as {
      android: { usesCleartextTraffic: boolean };
    };
    expect(props.android.usesCleartextTraffic).toBe(true);
  });

  it("sets the Android security and platform baseline", () => {
    const c = buildConfig(ENV);
    expect(c.android?.allowBackup).toBe(false);
    expect(c.android?.package).toBe("uk.co.jobproof.operative");
    expect(c.android?.blockedPermissions).toEqual(BLOCKED_PERMISSIONS);
    expect(BLOCKED_PERMISSIONS).toEqual(
      expect.arrayContaining([
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
      ]),
    );
    const props = (c.plugins as unknown[][]).find((p) => Array.isArray(p) && p[0] === "expo-build-properties")![1] as {
      android: { minSdkVersion: number; usesCleartextTraffic: boolean };
    };
    expect(props.android.minSdkVersion).toBe(29);
    expect(props.android.usesCleartextTraffic).toBe(false);
  });

  it("uses a distinct application id per variant so builds can sit side by side", () => {
    expect(buildConfig({ ...ENV, APP_VARIANT: "preview" }).android?.package).toBe("uk.co.jobproof.operative.preview");
  });

  it("has a plain splash (white background, the icon) through the expo-splash-screen plugin", () => {
    const plugin = (buildConfig(ENV).plugins as unknown[][]).find((p) => Array.isArray(p) && p[0] === "expo-splash-screen");
    expect(plugin).toBeDefined();
    expect(plugin![1]).toMatchObject({ backgroundColor: "#FFFFFF", image: "./assets/icon.png" });
  });
});
