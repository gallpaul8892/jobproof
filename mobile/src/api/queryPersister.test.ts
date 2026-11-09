import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { clearPersistedQueries, createUserPersister, persistKeyFor, shouldPersistQuery, type KvLike } from "./queryPersister";

jest.mock("expo-sqlite/kv-store", () => ({ __esModule: true, default: {} }));

function memory(): KvLike & { map: Map<string, string>; writes: number } {
  const map = new Map<string, string>();
  const m = {
    map,
    writes: 0,
    getItemSync: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItemSync: (k: string, v: string) => {
      m.writes += 1;
      map.set(k, v);
    },
    removeItemSync: (k: string) => void map.delete(k),
  };
  return m;
}

const client = (n: number): PersistedClient => ({
  timestamp: 1,
  buster: "1",
  clientState: { mutations: [], queries: Array.from({ length: n }, (_, i) => ({ queryKey: ["operative", i] })) as never },
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("createUserPersister", () => {
  it("saves under the user's key and restores the same client", async () => {
    const kv = memory();
    const p = createUserPersister("u1", { storage: kv, throttleMs: 0 });
    await p.persistClient(client(2));
    expect(kv.map.has("jobproof.query.v1.u1")).toBe(true);
    expect(persistKeyFor("u1")).toBe("jobproof.query.v1.u1");
    expect(await p.restoreClient()).toEqual(client(2));
  });

  it("keeps users apart", async () => {
    const kv = memory();
    await createUserPersister("u1", { storage: kv, throttleMs: 0 }).persistClient(client(1));
    expect(await createUserPersister("u2", { storage: kv, throttleMs: 0 }).restoreClient()).toBeUndefined();
  });

  it("writes a burst of changes once, with the latest, and flush writes at once", () => {
    const kv = memory();
    const p = createUserPersister("u1", { storage: kv, throttleMs: 1000 });
    p.persistClient(client(1));
    p.persistClient(client(2));
    p.persistClient(client(3));
    expect(kv.writes).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(kv.writes).toBe(1);
    expect((JSON.parse(kv.map.get("jobproof.query.v1.u1")!) as PersistedClient).clientState.queries).toHaveLength(3);
    p.persistClient(client(4));
    p.flush();
    expect(kv.writes).toBe(2);
    jest.advanceTimersByTime(2000);
    expect(kv.writes).toBe(2); // the timer was cancelled by the flush
  });

  it("removes a corrupt entry and restores nothing", async () => {
    const kv = memory();
    kv.map.set("jobproof.query.v1.u1", "{oops");
    expect(await createUserPersister("u1", { storage: kv }).restoreClient()).toBeUndefined();
    expect(kv.map.has("jobproof.query.v1.u1")).toBe(false);
  });

  it("survives a full or failing store", () => {
    const kv = memory();
    kv.setItemSync = () => {
      throw new Error("disk full");
    };
    const p = createUserPersister("u1", { storage: kv, throttleMs: 0 });
    expect(() => p.persistClient(client(1))).not.toThrow();
  });

  it("sign-out clears the entry and a pending or later save cannot bring it back", () => {
    const kv = memory();
    const p = createUserPersister("u1", { storage: kv, throttleMs: 1000 });
    p.persistClient(client(2));
    p.flush();
    p.persistClient(client(3)); // pending when the user signs out
    clearPersistedQueries("u1", kv);
    expect(kv.map.has("jobproof.query.v1.u1")).toBe(false);
    jest.advanceTimersByTime(5000);
    p.flush();
    p.persistClient(client(4));
    p.flush();
    expect(kv.map.has("jobproof.query.v1.u1")).toBe(false);
  });
});

describe("shouldPersistQuery", () => {
  const q = (key: unknown[], status: string) => ({ queryKey: key, state: { status } }) as never;
  it("keeps only successful operative queries", () => {
    expect(shouldPersistQuery(q(["operative", "jobs"], "success"))).toBe(true);
    expect(shouldPersistQuery(q(["operative", "job", "x"], "success"))).toBe(true);
    expect(shouldPersistQuery(q(["operative", "jobs"], "error"))).toBe(false);
    expect(shouldPersistQuery(q(["operative", "jobs"], "pending"))).toBe(false);
    expect(shouldPersistQuery(q(["branding"], "success"))).toBe(false);
    expect(shouldPersistQuery(q(["me"], "success"))).toBe(false);
  });
});
