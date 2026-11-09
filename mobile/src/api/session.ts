import Constants from "expo-constants";
import { Platform } from "react-native";
import { deviceSessionApi, parseSemver } from "@jobproof/shared";
import { SecureTokenStore } from "./secureTokenStore";
import { SessionManager } from "./sessionManager";
import { kvUserCache } from "./userCache";

let instance: SessionManager | undefined;

/** Version sent at sign-in; the server compares it with the minimum supported (T-003n). */
export function appVersion(version: string | undefined = Constants.expoConfig?.version): string {
  return version !== undefined && parseSemver(version) !== null ? version : "0.0.0";
}

/**
 * The one SessionManager for the process. The foreground app and any future headless task must
 * use this instance, so there is only ever one refresh in flight (see SessionManager).
 */
export function getSessionManager(): SessionManager {
  instance ??= new SessionManager({
    secrets: new SecureTokenStore(),
    api: deviceSessionApi,
    userCache: kvUserCache,
    appVersion: appVersion(),
    platform: Platform.OS === "ios" ? "ios" : "android",
    deviceName: Platform.OS === "android" ? `Android ${String(Platform.Version)}` : null,
  });
  return instance;
}
