import { callApi, configureApiClient } from "@jobproof/shared";
import { deviceSessionApi } from "@jobproof/shared";
import { DAN, DEVICE, getAppStatus, getMe, json, problemResponse, MemorySecrets, memoryUserCache, problem, refreshTokenOf, scriptedApi, session } from "../../test/helpers";
import { REFRESH_MARGIN_MS, RETRY_DELAY_MS, SessionManager } from "./sessionManager";
import { sessionApiOptions } from "./sessionClient";

function build(opts: { token?: string; user?: typeof DAN; now?: () => number } = {}) {
  const secrets = new MemorySecrets();
  if (opts.token) secrets.token = opts.token;
  const users = memoryUserCache(opts.user);
  const fake = scriptedApi();
  const manager = new SessionManager({
    secrets,
    api: fake.api,
    userCache: users,
    appVersion: "0.1.0",
    deviceName: "Android 14",
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { manager, secrets, users, ...fake };
}

afterEach(() => jest.useRealTimers());

describe("sign in", () => {
  it("sends device id, platform and app version, then keeps the refresh token in secure storage and the access token in memory (scenarios 1, 6)", async () => {
    const t = build();
    await t.manager.signIn("painter@jobproof.test", "Painter123!");
    expect(t.calls.create).toEqual([
      { email: "painter@jobproof.test", password: "Painter123!", device_id: DEVICE, platform: "android", app_version: "0.1.0", device_name: "Android 14" },
    ]);
    expect(t.secrets.token).toBe(refreshTokenOf(1));
    expect(t.manager.accessTokenStore.get()).toBe("access-1");
    expect(t.manager.getSnapshot()).toMatchObject({ status: "signed_in", user: { full_name: "Dan Hughes" } });
    expect(t.users.user?.id).toBe(DAN.id);
    t.manager.dispose();
  });

  it("stores nothing when the server refuses, e.g. operatives_only (scenario 3)", async () => {
    const t = build();
    t.script.create = async () => {
      throw problem(403, "operatives_only");
    };
    await expect(t.manager.signIn("manager@jobproof.test", "x")).rejects.toMatchObject({ code: "operatives_only" });
    expect(t.secrets.token).toBeNull();
    expect(t.secrets.writes).toEqual([]);
    expect(t.manager.accessTokenStore.get()).toBeNull();
    expect(t.users.user).toBeUndefined();
    expect(t.manager.status).toBe("signed_out");
  });
});

describe("restore after a restart (scenario 5)", () => {
  it("reads the refresh token, refreshes it, and stores the rotated one", async () => {
    const t = build({ token: refreshTokenOf(1) });
    await t.manager.restore();
    expect(t.calls.refresh).toEqual([refreshTokenOf(1)]);
    expect(t.secrets.token).toBe(refreshTokenOf(2));
    expect(t.manager.accessTokenStore.get()).toBe("access-2");
    expect(t.manager.getSnapshot()).toMatchObject({ status: "signed_in", ready: true, user: { full_name: "Dan Hughes" } });
    t.manager.dispose();
  });

  it("with nothing stored it is signed out and ready", async () => {
    const t = build();
    await t.manager.restore();
    expect(t.manager.getSnapshot()).toMatchObject({ status: "signed_out", ready: true });
    expect(t.calls.refresh).toEqual([]);
  });

  it("an unreadable Keystore entry counts as signed out", async () => {
    const t = build();
    t.secrets.get = () => {
      throw new Error("keystore");
    };
    await t.manager.restore();
    expect(t.manager.status).toBe("signed_out");
  });

  it("offline with a known user: signed in at once, stays signed in, retries later (scenario 12 / T-003i)", async () => {
    jest.useFakeTimers();
    const t = build({ token: refreshTokenOf(1), user: DAN });
    t.script.refresh = async () => {
      throw problem(0, "network_error");
    };
    await t.manager.restore();
    expect(t.manager.getSnapshot()).toMatchObject({ status: "signed_in", ready: true, user: { full_name: "Dan Hughes" } });
    expect(t.secrets.token).toBe(refreshTokenOf(1)); // kept
    t.script.refresh = async () => session(2);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS + 1);
    expect(t.secrets.token).toBe(refreshTokenOf(2));
    t.manager.dispose();
  });

  it("offline with no cached user: ready and signed in, name unknown", async () => {
    const t = build({ token: refreshTokenOf(1) });
    t.script.refresh = async () => {
      throw problem(0, "timeout");
    };
    await t.manager.restore();
    expect(t.manager.getSnapshot()).toMatchObject({ status: "signed_in", ready: true, user: undefined });
    t.manager.dispose();
  });

  it("session_ended on restore: needs_sign_in, credentials removed, user cache cleared", async () => {
    const t = build({ token: refreshTokenOf(1), user: DAN });
    t.script.refresh = async () => {
      throw problem(401, "session_ended");
    };
    await t.manager.restore();
    expect(t.manager.getSnapshot()).toMatchObject({ status: "needs_sign_in", ready: true });
    expect(t.secrets.token).toBeNull();
    expect(t.users.user).toBeUndefined();
  });
});

describe("single flight (decision: one refresh across foreground and any headless task)", () => {
  it("two concurrent refreshes of the same token make one request and share the answer", async () => {
    const t = build({ token: refreshTokenOf(1) });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    t.script.refresh = async () => {
      await gate;
      return session(2);
    };
    const first = t.manager.refresh();
    const second = t.manager.refresh(); // e.g. the future background task
    expect(second).toBe(first);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(t.calls.refresh).toEqual([refreshTokenOf(1)]);
    t.manager.dispose();
  });

  it("sequential refreshes each use the token the previous one stored", async () => {
    const t = build({ token: refreshTokenOf(1) });
    t.script.refresh = async (token) => session(token === refreshTokenOf(1) ? 2 : 3);
    await t.manager.refresh();
    await t.manager.refresh();
    expect(t.calls.refresh).toEqual([refreshTokenOf(1), refreshTokenOf(2)]);
    expect(t.secrets.token).toBe(refreshTokenOf(3));
    t.manager.dispose();
  });

  it("the new refresh token is stored before the refresh reports success", async () => {
    const t = build({ token: refreshTokenOf(1) });
    const order: string[] = [];
    const set = t.secrets.set.bind(t.secrets);
    t.secrets.set = (token: string) => {
      order.push("stored");
      return set(token);
    };
    await t.manager.refresh().then(() => order.push("resolved"));
    expect(order).toEqual(["stored", "resolved"]);
    t.manager.dispose();
  });

  it("three concurrent 401s through the shared client make one refresh and no onUnauthorized (end to end)", async () => {
    const t = build({ token: refreshTokenOf(1), user: DAN });
    await t.manager.signIn("a", "b"); // access-1, refresh-1
    let seenRefreshes = 0;
    t.script.refresh = async () => {
      seenRefreshes += 1;
      await new Promise((r) => setTimeout(r, 5));
      return session(2);
    };
    configureApiClient({
      baseUrl: "http://api.test",
      ...sessionApiOptions(t.manager),
      fetch: async (input) => {
        const auth = input instanceof Request ? input.headers.get("Authorization") : null;
        return auth === "Bearer access-2" ? json(DAN) : problemResponse(401, "unauthenticated");
      },
    });
    await Promise.all([callApi(() => getMe()), callApi(() => getMe()), callApi(() => getMe())]);
    expect(seenRefreshes).toBe(1);
    expect(t.manager.status).toBe("signed_in");
    t.manager.dispose();
  });

  it("a refresh that is running when the user signs out is discarded and cannot revive the session", async () => {
    const t = build({ token: refreshTokenOf(1) });
    await t.manager.restore();
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const running = new Promise<void>((r) => (started = r));
    t.script.refresh = async () => {
      started();
      await new Promise<void>((r) => (release = r));
      return session(5);
    };
    const refresh = t.manager.refresh();
    await running;
    const out = t.manager.signOut();
    release();
    await refresh;
    await out;
    expect(t.manager.status).toBe("signed_out");
    expect(t.secrets.token).toBeNull();
    expect(t.manager.accessTokenStore.get()).toBeNull();
    t.manager.dispose();
  });
});

describe("proactive refresh", () => {
  it("refreshes 60 seconds before the access token expires", async () => {
    jest.useFakeTimers();
    const t = build();
    t.script.create = async () => session(1, DAN, 900);
    t.script.refresh = async () => session(2, DAN, 900);
    await t.manager.signIn("a", "b");
    await jest.advanceTimersByTimeAsync(900_000 - REFRESH_MARGIN_MS - 1000);
    expect(t.calls.refresh).toEqual([]);
    await jest.advanceTimersByTimeAsync(1500);
    expect(t.calls.refresh).toEqual([refreshTokenOf(1)]);
    expect(t.manager.accessTokenStore.get()).toBe("access-2");
    // and it schedules the next one
    t.script.refresh = async () => session(3);
    await jest.advanceTimersByTimeAsync(900_000 - REFRESH_MARGIN_MS + 10);
    expect(t.calls.refresh).toHaveLength(2);
    t.manager.dispose();
  });

  it("an access token that lives under 60 seconds refreshes at once", async () => {
    jest.useFakeTimers();
    const t = build();
    t.script.create = async () => session(1, DAN, 30);
    await t.manager.signIn("a", "b");
    await jest.advanceTimersByTimeAsync(1);
    expect(t.calls.refresh).toHaveLength(1);
    t.manager.dispose();
  });

  it("stops after sign-out", async () => {
    jest.useFakeTimers();
    const t = build();
    await t.manager.signIn("a", "b");
    await t.manager.signOut();
    await jest.advanceTimersByTimeAsync(2_000_000);
    expect(t.calls.refresh).toEqual([]);
  });
});

describe("the server ends the session", () => {
  it("account_inactive (scenario 11): status inactive, tokens gone, nothing else touched", async () => {
    const t = build({ token: refreshTokenOf(1), user: DAN });
    await t.manager.signIn("a", "b");
    t.script.refresh = async () => {
      throw problem(401, "account_inactive");
    };
    expect(await t.manager.refresh()).toBe(false);
    expect(t.manager.getSnapshot()).toMatchObject({ status: "inactive", user: undefined });
    expect(t.secrets.token).toBeNull();
    expect(t.manager.accessTokenStore.get()).toBeNull();
  });

  it("through the client: a 401 account_inactive call ends in inactive with onUnauthorized-driven state, once", async () => {
    const t = build();
    await t.manager.signIn("a", "b");
    t.script.refresh = async () => {
      throw problem(401, "account_inactive");
    };
    configureApiClient({
      baseUrl: "http://api.test",
      ...sessionApiOptions(t.manager),
      fetch: async () => problemResponse(401, "account_inactive"),
    });
    const results = await Promise.all([1, 2, 3].map(() => callApi(() => getMe()).catch((e: unknown) => e)));
    for (const r of results) expect(r).toMatchObject({ status: 401 });
    expect(t.calls.refresh).toHaveLength(1);
    expect(t.manager.status).toBe("inactive");
  });

  it("no signal during a refresh does not sign the operative out", async () => {
    const t = build();
    await t.manager.signIn("a", "b");
    t.script.refresh = async () => {
      throw problem(0, "network_error");
    };
    configureApiClient({
      baseUrl: "http://api.test",
      ...sessionApiOptions(t.manager),
      fetch: async () => problemResponse(401, "unauthenticated"),
    });
    await callApi(() => getMe()).catch(() => undefined);
    expect(t.manager.status).toBe("signed_in");
    expect(t.secrets.token).toBe(refreshTokenOf(1));
    t.manager.dispose();
  });

  it("a server error or rate limit during refresh is also not a sign-out", async () => {
    for (const status of [429, 500, 503, 426]) {
      const t = build();
      await t.manager.signIn("a", "b");
      t.script.refresh = async () => {
        throw problem(status, "x");
      };
      expect(await t.manager.refresh()).toBe(false);
      expect(t.manager.status).toBe("signed_in");
      t.manager.dispose();
    }
  });

  it("a call still refused after a good refresh sends the operative to sign-in", async () => {
    const t = build();
    await t.manager.signIn("a", "b");
    configureApiClient({
      baseUrl: "http://api.test",
      ...sessionApiOptions(t.manager),
      fetch: async () => problemResponse(401, "session_ended"),
    });
    await callApi(() => getMe()).catch(() => undefined);
    expect(t.manager.status).toBe("needs_sign_in");
    expect(t.secrets.token).toBeNull();
  });
});

describe("sign out (scenario 8)", () => {
  it("tells the server, clears every credential and the cached user", async () => {
    const t = build();
    await t.manager.signIn("a", "b");
    await t.manager.signOut();
    expect(t.calls.end).toBe(1);
    expect(t.secrets.token).toBeNull();
    expect(t.manager.accessTokenStore.get()).toBeNull();
    expect(t.users.user).toBeUndefined();
    expect(t.manager.getSnapshot()).toMatchObject({ status: "signed_out", user: undefined });
  });

  it("is best effort: offline it still clears everything", async () => {
    const t = build();
    await t.manager.signIn("a", "b");
    t.script.end = async () => {
      throw problem(0, "network_error");
    };
    await t.manager.signOut();
    expect(t.secrets.token).toBeNull();
    expect(t.manager.status).toBe("signed_out");
  });

  it("keeps the device id: it identifies the install, not the user", async () => {
    const t = build();
    await t.manager.signIn("a", "b");
    await t.manager.signOut();
    await t.manager.signIn("a", "b");
    expect(t.calls.create.map((c) => (c as { device_id: string }).device_id)).toEqual([DEVICE, DEVICE]);
    t.manager.dispose();
  });
});

describe("the real session operations never refresh (no deadlock)", () => {
  it("refreshDeviceSession answering 401 session_ended ends the original call promptly", async () => {
    const secrets = new MemorySecrets();
    secrets.token = refreshTokenOf(1);
    const manager = new SessionManager({ secrets, api: deviceSessionApi, userCache: memoryUserCache(DAN), appVersion: "0.1.0" });
    configureApiClient({
      baseUrl: "http://api.test",
      ...sessionApiOptions(manager),
      fetch: async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        const code = url.endsWith("/auth/sessions/refresh") ? "session_ended" : "unauthenticated";
        return problemResponse(401, code);
      },
    });
    await manager.restore();
    expect(manager.status).toBe("needs_sign_in");
    const outcome = await Promise.race([callApi(() => getAppStatus()).catch((e: unknown) => e), new Promise((r) => setTimeout(() => r("hung"), 1000))]);
    expect(outcome).not.toBe("hung");
  });
});
