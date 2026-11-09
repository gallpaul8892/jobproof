import Constants from "expo-constants";

export interface AppConfig {
  /** API origin, injected at build time by app.config.ts from API_BASE_URL. */
  apiBaseUrl: string;
  variant: string;
}

/** Reads the runtime configuration baked into the app config by the build (never hardcoded). */
export function readConfig(extra: Record<string, unknown> | undefined = Constants.expoConfig?.extra): AppConfig {
  const apiBaseUrl = extra?.apiBaseUrl;
  if (typeof apiBaseUrl !== "string" || apiBaseUrl.length === 0) {
    throw new Error("The app was built without a server address (API_BASE_URL).");
  }
  return { apiBaseUrl, variant: typeof extra?.variant === "string" ? extra.variant : "production" };
}
