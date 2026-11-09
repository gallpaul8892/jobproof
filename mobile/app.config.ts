// Self-contained on purpose: Expo transpiles only this file, not the local modules it imports.
import type { ExpoConfig } from "expo/config";

export type Variant = "development" | "preview" | "screenshots" | "production";
const VARIANTS: readonly Variant[] = ["development", "preview", "screenshots", "production"];

/** Permissions the app must never hold (design section 12). T-003p checks the built APK too. */
export const BLOCKED_PERMISSIONS = [
  "android.permission.RECORD_AUDIO",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.ACCESS_MEDIA_LOCATION",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.POST_NOTIFICATIONS",
];

/**
 * Builds the Expo config from the build environment. Throws when the server address is missing
 * or unsafe, so a build can never silently point nowhere (T-003a scenario 6). Nothing in git
 * holds an address: it comes from API_BASE_URL (EAS environment variables, or .env.local).
 */
export function buildConfig(env: Record<string, string | undefined>): ExpoConfig {
  const apiBaseUrl = env.API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!apiBaseUrl) {
    throw new Error("API_BASE_URL is required: set it in mobile/.env.local or the EAS environment.");
  }
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    throw new Error("API_BASE_URL must be an absolute URL such as https://api.example.com.");
  }
  const variant = (env.APP_VARIANT ?? "production") as Variant;
  if (!VARIANTS.includes(variant)) {
    throw new Error(`APP_VARIANT must be one of ${VARIANTS.join(", ")}.`);
  }
  const cleartext = variant === "development";
  if (url.protocol !== "https:" && !(cleartext && url.protocol === "http:")) {
    throw new Error("API_BASE_URL must be https (plain http is allowed only when APP_VARIANT=development).");
  }
  const suffix = variant === "production" ? "" : variant === "development" ? ".dev" : `.${variant}`;
  return {
    name: variant === "production" ? "JobProof" : `JobProof (${variant})`,
    slug: "jobproof-operative",
    scheme: "jobproof",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    experiments: { typedRoutes: true },
    android: {
      package: `uk.co.jobproof.operative${suffix}`,
      allowBackup: false,
      blockedPermissions: BLOCKED_PERMISSIONS,
      adaptiveIcon: { foregroundImage: "./assets/icon.png", backgroundColor: "#000000" /* hidden: the icon is full-bleed */ },
    },
    plugins: [
      "expo-router",
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 29,
            compileSdkVersion: 37,
            targetSdkVersion: 36,
            usesCleartextTraffic: cleartext,
          },
        },
      ],
    ],
    extra: { apiBaseUrl, variant },
  };
}

// Expo evaluates this file with the build environment (EAS environment variables or .env.local).
export default () => buildConfig(process.env);
