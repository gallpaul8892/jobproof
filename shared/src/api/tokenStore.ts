/** Platform-specific persistence of the bearer token (web: sessionStorage; mobile: SecureStore). */
export interface TokenStore {
  get(): string | null | undefined | Promise<string | null | undefined>;
  set(token: string): void | Promise<void>;
  clear(): void | Promise<void>;
}
