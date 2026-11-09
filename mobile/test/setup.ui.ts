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

// expo-secure-store has no JS fallback under Jest. In-memory map, reachable from tests.
const mockSecrets = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  __esModule: true,
  getItemAsync: async (k: string) => (mockSecrets.has(k) ? mockSecrets.get(k)! : null),
  setItemAsync: async (k: string, v: string) => void mockSecrets.set(k, v),
  deleteItemAsync: async (k: string) => void mockSecrets.delete(k),
}));
(globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore = mockSecrets;
beforeEach(() => mockSecrets.clear());
