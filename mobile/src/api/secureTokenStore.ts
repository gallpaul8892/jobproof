import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "@jobproof/shared";
import { randomUuid } from "./uuid";

/** The part of expo-secure-store used here, so tests can pass an in-memory fake. */
export interface SecretsBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const REFRESH_TOKEN_KEY = "jobproof.refresh_token.v1";
export const DEVICE_ID_KEY = "jobproof.device_id.v1";

/**
 * Strategy: the shared `TokenStore` over the Android Keystore-backed secure store, holding the
 * refresh token (NFR-10). The access token never lands here: it lives in memory in
 * SessionManager. Also owns the device id, which survives sign-out (it identifies the install).
 */
export class SecureTokenStore implements TokenStore {
  constructor(private readonly backend: SecretsBackend = SecureStore) {}

  async get(): Promise<string | null> {
    return this.backend.getItemAsync(REFRESH_TOKEN_KEY);
  }

  async set(token: string): Promise<void> {
    await this.backend.setItemAsync(REFRESH_TOKEN_KEY, token);
  }

  async clear(): Promise<void> {
    await this.backend.deleteItemAsync(REFRESH_TOKEN_KEY);
  }

  /** The install's random UUID, created on first use and kept in the secure store. */
  deviceId(): Promise<string> {
    // Memoised so two callers at first launch cannot create two ids.
    this.deviceIdPending ??= this.loadDeviceId().catch((error: unknown) => {
      this.deviceIdPending = undefined;
      throw error;
    });
    return this.deviceIdPending;
  }

  private deviceIdPending: Promise<string> | undefined;

  private async loadDeviceId(): Promise<string> {
    const existing = await this.backend.getItemAsync(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = randomUuid();
    await this.backend.setItemAsync(DEVICE_ID_KEY, created);
    return created;
  }
}
