/** Stand-in for expo-sqlite/kv-store in the browser demo: a plain Map, empty again after a reload. */
const map = new Map<string, string>();

const Storage = {
  getItemSync: (key: string): string | null => map.get(key) ?? null,
  setItemSync: (key: string, value: string): void => void map.set(key, value),
  removeItemSync: (key: string): void => void map.delete(key),
};

export default Storage;
