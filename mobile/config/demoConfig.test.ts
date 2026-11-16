import { buildConfig, buildDemoConfig } from "../app.config";

describe("the browser demo's Expo config", () => {
  it("adds a single-page web export below the base path and needs no real server address", () => {
    const c = buildDemoConfig({ DEMO_BASE_URL: "/jobproof/mobile/" });
    expect(c.web).toEqual({ bundler: "metro", output: "single" });
    expect(c.experiments).toMatchObject({ baseUrl: "/jobproof/mobile", typedRoutes: true });
    expect(c.extra?.apiBaseUrl).toBe("https://demo.invalid");
  });

  it("leaves the native settings exactly as the real config has them", () => {
    const real = buildConfig({ API_BASE_URL: "https://demo.invalid" });
    const { web, experiments, ...rest } = buildDemoConfig({});
    void web;
    const { experiments: realExperiments, ...realRest } = real;
    expect(rest).toEqual(realRest);
    expect(experiments).toEqual(realExperiments); // no base path when none is given
  });

  it("the real config still refuses a missing server address", () => {
    expect(() => buildConfig({})).toThrow(/API_BASE_URL is required/);
  });
});
