import fs from "node:fs";
import path from "node:path";
import Storage from "./kvStore";
import * as SecureStore from "./secureStore";

describe("kv-store stand-in", () => {
  it("stores, reads and removes strings in memory", () => {
    expect(Storage.getItemSync("k")).toBeNull();
    Storage.setItemSync("k", "v");
    expect(Storage.getItemSync("k")).toBe("v");
    Storage.removeItemSync("k");
    expect(Storage.getItemSync("k")).toBeNull();
  });
});

describe("secure-store stand-in", () => {
  it("keeps secrets in memory with the same async API as expo-secure-store", async () => {
    expect(await SecureStore.getItemAsync("s")).toBeNull();
    await SecureStore.setItemAsync("s", "secret");
    expect(await SecureStore.getItemAsync("s")).toBe("secret");
    await SecureStore.deleteItemAsync("s");
    expect(await SecureStore.getItemAsync("s")).toBeNull();
  });

  it("never touches browser storage or cookies", () => {
    // The module has no reference to them at all (comments aside): reading its source is the honest check.
    const src = fs.readFileSync(path.join(__dirname, "secureStore.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/localStorage|sessionStorage|cookie|indexedDB/);
  });
});
