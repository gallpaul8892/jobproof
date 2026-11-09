import { ApiError, type DeviceSession, type DeviceSessionApi, type TokenStore, type User } from "@jobproof/shared";

/** Where the session stands. `needs_sign_in` = the server ended it; `inactive` = account deactivated. */
export type SessionStatus = "signed_out" | "signed_in" | "needs_sign_in" | "inactive";

export interface SessionState {
  status: SessionStatus;
  /** False until the first look at secure storage has finished (the app shows a spinner, not sign-in). */
  ready: boolean;
  user: User | undefined;
}

/** The refresh token and device id; implemented by SecureTokenStore. */
export interface SessionSecrets extends TokenStore {
  deviceId(): Promise<string>;
}

/** Last signed-in user, so the header can show a name with no signal. Not a credential. */
export interface UserCache {
  read(): User | undefined;
  write(user: User): void;
  clear(): void;
}

export interface SessionManagerDeps {
  secrets: SessionSecrets;
  api: DeviceSessionApi;
  userCache: UserCache;
  appVersion: string;
  platform?: "android" | "ios";
  deviceName?: string | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000;
/** After a refresh that failed for lack of signal, try again after this long. */
export const RETRY_DELAY_MS = 30_000;

/** Runs tasks one at a time, in order. A failing task does not block the next. */
class Lock {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const SIGNED_OUT: SessionState = { status: "signed_out", ready: true, user: undefined };

/**
 * Owns the operative's session. The access token and its expiry live in memory only; the refresh
 * token and device id are in the secure store.
 *
 * Decision (T-003 review): a refresh token is single use, so two concurrent refreshes of the same
 * token must be single-flighted. `refresh()` returns one shared promise and runs under a lock that
 * also serialises sign-in and sign-out. The foreground app and any future headless task must call
 * `refresh()` on the one manager instance (the module singleton in `session.ts`); nothing else may
 * call the refresh operation. The server's 60 s grace rule only covers a lost response, not this.
 */
export class SessionManager {
  private state: SessionState = { status: "signed_out", ready: false, user: undefined };
  private readonly listeners = new Set<() => void>();
  private readonly lock = new Lock();
  private inFlight: Promise<boolean> | undefined;
  private restoring: Promise<void> | undefined;
  private accessToken: string | undefined;
  private expiresAt = 0;
  private timer: unknown;
  /** Bumped by sign-in and sign-out so a refresh that was running across them is discarded. */
  private generation = 0;
  /** The last refresh failed for a reason that says nothing about the session (no signal, 5xx). */
  private transientFailure = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: SessionManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** In-memory access token for the shared client (the refresh token is never given to it). */
  readonly accessTokenStore: TokenStore = {
    get: () => this.accessToken ?? null,
    set: (token) => {
      this.accessToken = token;
    },
    clear: () => {
      this.accessToken = undefined;
    },
  };

  // useSyncExternalStore contract
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): SessionState => this.state;

  /** When the in-memory access token expires by the device clock (0 = none). Only a hint. */
  get accessTokenExpiresAt(): number {
    return this.expiresAt;
  }

  get status(): SessionStatus {
    return this.state.status;
  }

  private set(next: Partial<SessionState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  /** Looks at secure storage once at launch. Offline-safe: a known user is signed in at once. */
  restore(): Promise<void> {
    this.restoring ??= this.doRestore();
    return this.restoring;
  }

  private async doRestore(): Promise<void> {
    let token: string | null | undefined;
    try {
      token = await this.deps.secrets.get();
    } catch {
      token = null; // an unreadable Keystore entry is as good as none
    }
    if (!token) {
      this.set(SIGNED_OUT);
      return;
    }
    const user = this.deps.userCache.read();
    if (user) this.set({ status: "signed_in", ready: true, user });
    await this.refresh(); // sets needs_sign_in or inactive when the server says so
    if (!this.state.ready) this.set({ ready: true, ...(this.transientFailure ? { status: "signed_in" as const } : {}) });
  }

  /**
   * Exchanges the stored refresh token. One flight at a time: concurrent callers get the same
   * promise. Resolves true when a new access token is ready, false otherwise (never rejects).
   */
  refresh = (): Promise<boolean> => {
    this.inFlight ??= this.lock.run(() => this.doRefresh()).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  };

  private async doRefresh(): Promise<boolean> {
    const generation = this.generation;
    let token: string | null | undefined;
    try {
      token = await this.deps.secrets.get();
    } catch {
      token = null;
    }
    if (!token) {
      if (this.state.status === "signed_in") await this.endLocally("needs_sign_in");
      return false;
    }
    let session: DeviceSession;
    try {
      session = await this.deps.api.refresh(token);
    } catch (error) {
      if (generation !== this.generation) return false;
      if (error instanceof ApiError && error.status === 401 && error.code === "account_inactive") {
        await this.endLocally("inactive");
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 422)) {
        await this.endLocally("needs_sign_in"); // session_ended: expired, revoked or reused
      } else {
        this.transientFailure = true; // no signal, timeout, 5xx, rate limit: stay signed in and retry
        this.scheduleRetry();
      }
      return false;
    }
    if (generation !== this.generation) return false;
    try {
      // Persist the new refresh token before anything else: the old one is spent.
      await this.deps.secrets.set(session.refresh_token);
    } catch {
      this.transientFailure = true;
      this.scheduleRetry();
      return false;
    }
    this.transientFailure = false;
    this.apply(session);
    return true;
  }

  /** Called by the shared client when a refresh failed or a retried call was refused again. */
  readonly handleUnauthorized = (): void => {
    if (this.state.status !== "signed_in" || this.transientFailure) return;
    void this.endLocally("needs_sign_in");
  };

  async signIn(email: string, password: string): Promise<void> {
    await this.lock.run(async () => {
      this.generation += 1;
      const device_id = await this.deps.secrets.deviceId();
      const session = await this.deps.api.create({
        email,
        password,
        device_id,
        platform: this.deps.platform ?? "android",
        app_version: this.deps.appVersion,
        device_name: this.deps.deviceName ?? null,
      });
      await this.deps.secrets.set(session.refresh_token);
      this.transientFailure = false;
      this.apply(session);
    });
  }

  /** Ends the session: tells the server (best effort), then forgets every credential on the phone. */
  async signOut(): Promise<void> {
    await this.lock.run(async () => {
      this.generation += 1;
      if (this.accessToken) {
        try {
          await this.deps.api.end();
        } catch {
          /* offline or already ended: the refresh token is deleted below either way */
        }
      }
      await this.wipe();
      this.set({ status: "signed_out", ready: true, user: undefined });
    });
  }

  /** Stops the proactive timer (tests, hot reload). */
  dispose(): void {
    this.cancelTimer();
  }

  private apply(session: DeviceSession): void {
    this.accessToken = session.access_token;
    this.expiresAt = this.now() + session.expires_in * 1000;
    this.deps.userCache.write(session.user);
    this.set({ status: "signed_in", ready: true, user: session.user });
    this.schedule(Math.max(0, session.expires_in * 1000 - REFRESH_MARGIN_MS));
  }

  private schedule(delayMs: number): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.refresh();
    }, delayMs);
  }

  private scheduleRetry(): void {
    if (this.state.status === "signed_in") this.schedule(RETRY_DELAY_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** The server ended the session: drop credentials, keep everything else on the phone. */
  private async endLocally(status: "needs_sign_in" | "inactive"): Promise<void> {
    this.generation += 1;
    await this.wipe();
    this.set({ status, ready: true, user: undefined });
  }

  private async wipe(): Promise<void> {
    this.cancelTimer();
    this.accessToken = undefined;
    this.expiresAt = 0;
    this.transientFailure = false;
    this.deps.userCache.clear();
    try {
      await this.deps.secrets.clear();
    } catch {
      /* nothing more can be done; the token is dead on the server after sign-out or end */
    }
  }
}
