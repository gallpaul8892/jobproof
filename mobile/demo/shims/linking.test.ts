// react-native-web's dist is ESM, which Jest does not transform, so its Linking is replaced by a recording fake.
jest.mock("react-native-web/dist/exports/Linking", () => ({
  __esModule: true,
  default: {
    openURL: jest.fn(async () => undefined),
    canOpenURL: jest.fn(async () => true),
    openSettings: jest.fn(async () => undefined),
    getInitialURL: async () => "http://localhost/",
  },
}));

import Linking from "./Linking";

const mockBase = (jest.requireMock("react-native-web/dist/exports/Linking") as { default: { openURL: jest.Mock } }).default;

describe("Linking stand-in", () => {
  it("refuses the links only a phone can follow, so the app shows its own message", async () => {
    await expect(Linking.openURL("geo:0,0?q=1%20High%20Street")).rejects.toThrow(/phone app/);
    await expect(Linking.openURL("tel:+447700900101")).rejects.toThrow(/phone app/);
    await expect(Linking.canOpenURL("geo:0,0")).resolves.toBe(false);
    await expect(Linking.openSettings()).rejects.toThrow();
    expect(mockBase.openURL).not.toHaveBeenCalled();
  });

  it("leaves ordinary web links, and everything else, to react-native-web", async () => {
    await Linking.openURL("https://example.com/help", "_blank");
    expect(mockBase.openURL).toHaveBeenCalledWith("https://example.com/help", "_blank");
    await expect(Linking.canOpenURL("https://example.com")).resolves.toBe(true);
    await expect((Linking as unknown as { getInitialURL(): Promise<string> }).getInitialURL()).resolves.toBe("http://localhost/");
  });
});
