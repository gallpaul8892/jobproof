import { fireEvent, render, screen } from "@testing-library/react-native";
import { fillSignIn } from "../frame";
import { DemoAccounts, SignInScreen } from "./SignInWithDemoAccounts";

jest.mock("../frame", () => ({ fillSignIn: jest.fn() }));

jest.mock("../../src/features/session/SignInScreen", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return { SignInScreen: ({ footer }: { footer?: unknown }) => <View testID="real-sign-in">{footer as never}</View> };
});

describe("demo accounts on the sign-in screen", () => {
  it("is passed to the real sign-in screen as its footer, with three operatives", async () => {
    await render(<SignInScreen />);
    expect(screen.getByTestId("real-sign-in")).toBeTruthy();
    expect(screen.getByText("Demo accounts")).toBeTruthy();
    expect(screen.getByText("Local demo data only. Pick one to fill in the form.")).toBeTruthy();
    for (const i of [0, 1, 2]) expect(screen.getByTestId(`demo-account-${i}`)).toBeTruthy();
    expect(screen.queryByTestId("demo-account-3")).toBeNull();
    expect(screen.getAllByText("Operative")).toHaveLength(3);
    expect(screen.getByText("priya.shah@jobproof.test")).toBeTruthy();
  });

  it("labels each Use button for screen readers and keeps it at least 44 high", async () => {
    await render(<DemoAccounts logins={[{ name: "Ann One", email: "ann@b.test", password: "pw1" }]} />);
    const button = screen.getByRole("button", { name: "Use operative account, Ann One" });
    expect(button.props.style).toBeDefined();
    expect(JSON.stringify(button.props.style)).toContain("44");
    expect(screen.queryByText("Email:")).toBeNull();
  });

  it("Use fills the email and password of that account only", async () => {
    const logins = [
      { name: "Ann One", email: "ann@b.test", password: "pw1" },
      { name: "Bo Two", email: "bo@b.test", password: "pw2" },
    ];
    await render(<DemoAccounts logins={logins} />);
    await fireEvent.press(screen.getByTestId("demo-use-account-1"));
    expect(fillSignIn).toHaveBeenCalledTimes(1);
    expect(fillSignIn).toHaveBeenCalledWith(logins[1]);
  });

  it("renders nothing without accounts", async () => {
    await render(<DemoAccounts logins={[]} />);
    expect(screen.queryByTestId("demo-accounts")).toBeNull();
  });
});
