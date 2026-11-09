import { readConfig } from "./config";

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { apiBaseUrl: "https://x.test", variant: "preview" } } } }));

describe("readConfig", () => {
  it("reads extra from the build", () => {
    expect(readConfig()).toEqual({ apiBaseUrl: "https://x.test", variant: "preview" });
  });
  it("throws when the build had no address", () => {
    expect(() => readConfig({})).toThrow(/API_BASE_URL/);
  });
  it("defaults the variant", () => {
    expect(readConfig({ apiBaseUrl: "https://y.test" }).variant).toBe("production");
  });
});
