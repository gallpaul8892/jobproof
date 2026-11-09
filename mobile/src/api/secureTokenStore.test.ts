import { DEVICE_ID_KEY, REFRESH_TOKEN_KEY, SecureTokenStore, type SecretsBackend } from "./secureTokenStore";

jest.mock("expo-secure-store", () => ({ __esModule: true }));

function backend() {
  const map = new Map<string, string>();
  const b: SecretsBackend & { map: Map<string, string>; reads: number } = {
    map,
    reads: 0,
    getItemAsync: async (k) => {
      b.reads += 1;
      await Promise.resolve();
      return map.get(k) ?? null;
    },
    setItemAsync: async (k, v) => void map.set(k, v),
    deleteItemAsync: async (k) => void map.delete(k),
  };
  return b;
}

describe("SecureTokenStore (scenario 6)", () => {
  it("keeps the refresh token under one secure-store key and nowhere else", async () => {
    const b = backend();
    const store = new SecureTokenStore(b);
    expect(await store.get()).toBeNull();
    await store.set("refresh-abc");
    expect(await store.get()).toBe("refresh-abc");
    expect([...b.map.keys()]).toEqual([REFRESH_TOKEN_KEY]);
    await store.clear();
    expect(await store.get()).toBeNull();
    expect(b.map.size).toBe(0);
  });

  it("creates the device id once, as a UUID, and reuses it", async () => {
    const b = backend();
    const store = new SecureTokenStore(b);
    const first = await store.deviceId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await store.deviceId()).toBe(first);
    expect(b.map.get(DEVICE_ID_KEY)).toBe(first);
    expect(await new SecureTokenStore(b).deviceId()).toBe(first); // a new process reads the same one
  });

  it("two callers at first launch get the same id", async () => {
    const store = new SecureTokenStore(backend());
    const [a, b] = await Promise.all([store.deviceId(), store.deviceId()]);
    expect(a).toBe(b);
  });

  it("sign-out clears the refresh token but keeps the device id", async () => {
    const b = backend();
    const store = new SecureTokenStore(b);
    const id = await store.deviceId();
    await store.set("r");
    await store.clear();
    expect(await store.deviceId()).toBe(id);
  });

  it("a failed first read does not poison later calls", async () => {
    const b = backend();
    let fail = true;
    const get = b.getItemAsync;
    b.getItemAsync = async (k) => {
      if (fail) throw new Error("keystore");
      return get(k);
    };
    const store = new SecureTokenStore(b);
    await expect(store.deviceId()).rejects.toThrow();
    fail = false;
    await expect(store.deviceId()).resolves.toMatch(/-/);
  });
});
