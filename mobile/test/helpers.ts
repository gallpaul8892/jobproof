import { ApiError, type DeviceSession, type DeviceSessionApi, type User } from "@jobproof/shared";
import type { SessionSecrets, UserCache } from "../src/api/sessionManager";

export const DAN: User = { id: "11111111-1111-4111-8111-111111111111", email: "painter@jobproof.test", full_name: "Dan Hughes", role: "painter" } as User;
export const PRIYA: User = { id: "22222222-2222-4222-8222-222222222222", email: "priya@jobproof.test", full_name: "Priya Shah", role: "painter" } as User;
export const DEVICE = "99999999-9999-4999-8999-999999999999";

export function session(n: number, user: User = DAN, expiresIn = 900): DeviceSession {
  return {
    access_token: `access-${n}`,
    token_type: "bearer",
    expires_in: expiresIn,
    refresh_token: `refresh-${n}-`.padEnd(30, "x"),
    refresh_expires_at: "2027-01-01T00:00:00Z",
    session_id: "7b0d8f2e-3c3a-4d57-9c53-0a1b2c3d4e5f",
    user,
  };
}

export const refreshTokenOf = (n: number) => session(n).refresh_token;

export function problem(status: number, code: string): ApiError {
  return new ApiError({ status, code, title: code });
}

export class MemorySecrets implements SessionSecrets {
  token: string | null = null;
  id: string | null = null;
  writes: string[] = [];
  get() {
    return this.token;
  }
  set(t: string) {
    this.token = t;
    this.writes.push(t);
  }
  clear() {
    this.token = null;
  }
  async deviceId() {
    this.id ??= DEVICE;
    return this.id;
  }
}

export function memoryUserCache(initial?: User): UserCache & { user: User | undefined } {
  const c = {
    user: initial,
    read: () => c.user,
    write: (u: User) => void (c.user = u),
    clear: () => void (c.user = undefined),
  };
  return c;
}

/** A DeviceSessionApi whose answers the test scripts; `calls` records what was sent. */
export function scriptedApi() {
  const calls = { create: [] as unknown[], refresh: [] as string[], end: 0 };
  const script: {
    create: (req: unknown) => Promise<DeviceSession>;
    refresh: (token: string) => Promise<DeviceSession>;
    end: () => Promise<void>;
  } = {
    create: async () => session(1),
    refresh: async () => session(2),
    end: async () => undefined,
  };
  const api: DeviceSessionApi = {
    create: (req) => {
      calls.create.push(req);
      return script.create(req);
    },
    refresh: (t) => {
      calls.refresh.push(t);
      return script.refresh(t);
    },
    end: () => {
      calls.end += 1;
      return script.end();
    },
  };
  return { api, calls, script };
}

// Generated SDK calls are not part of the shared public entry; tests reach them directly.
export { getMe, getAppStatus } from "../../shared/src/generated";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" } });
export const problemResponse = (status: number, code: string) => json({ title: code, status, code }, status);
