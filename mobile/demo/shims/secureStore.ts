/**
 * Stand-in for expo-secure-store in the browser demo. Held in memory only (nothing is written to
 * localStorage or cookies), so the demo "device" is new after every reload.
 */
const secrets = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return secrets.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  secrets.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  secrets.delete(key);
}
