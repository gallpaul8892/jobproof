// Native modules that jest-expo does not mock. kv-store is an in-memory map reachable from tests.
const mockStore = new Map<string, string>();

jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: {
    getItemSync: (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null),
    setItemSync: (k: string, v: string) => void mockStore.set(k, v),
    removeItemSync: (k: string) => void mockStore.delete(k),
  },
}));

(globalThis as unknown as { __kvStore: Map<string, string> }).__kvStore = mockStore;

beforeEach(() => mockStore.clear());
