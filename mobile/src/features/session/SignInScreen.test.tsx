import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { configureApiClient, deviceSessionApi } from "@jobproof/shared";
import { SecureTokenStore } from "../../api/secureTokenStore";
import { sessionApiOptions } from "../../api/sessionClient";
import { SessionManager } from "../../api/sessionManager";
import { kvUserCache } from "../../api/userCache";
import { json, problemResponse, DAN } from "../../../test/helpers";
import { SessionProvider } from "./SessionProvider";
import { SignInScreen } from "./SignInScreen";
import { MSG } from "./messages";

const secrets = () => (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;

const managers: SessionManager[] = [];
afterEach(() => managers.splice(0).forEach((m) => m.dispose()));

function setup(fetchImpl: jest.Mock) {
  const manager = new SessionManager({ secrets: new SecureTokenStore(), api: deviceSessionApi, userCache: kvUserCache, appVersion: "0.1.0" });
  managers.push(manager);
  configureApiClient({ baseUrl: "http://api.test", fetch: fetchImpl as unknown as typeof fetch, ...sessionApiOptions(manager) });
  return { manager };
}

async function renderScreen(fetchImpl: jest.Mock) {
  const { manager } = setup(fetchImpl);
  await render(
    <SessionProvider manager={manager}>
      <SignInScreen />
    </SessionProvider>,
  );
  return manager;
}

const typeCredentials = async (email: string, password: string) => {
  if (email) await fireEvent.changeText(screen.getByTestId("sign-in-email"), email);
  if (password) await fireEvent.changeText(screen.getByTestId("sign-in-password"), password);
};
const submit = () => fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

describe("scenario 4: empty fields", () => {
  it("shows both messages and sends no request", async () => {
    const fetchImpl = jest.fn();
    await renderScreen(fetchImpl);
    await submit();
    expect(await screen.findByText("Enter your email.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a blank (spaces only) email counts as empty, and typing clears that field's message", async () => {
    const fetchImpl = jest.fn();
    await renderScreen(fetchImpl);
    await typeCredentials("   ", "secret");
    await submit();
    expect(await screen.findByText(MSG.enterEmail)).toBeTruthy();
    expect(screen.queryByText(MSG.enterPassword)).toBeNull();
    await fireEvent.changeText(screen.getByTestId("sign-in-email"), "a@b.test");
    expect(screen.queryByText(MSG.enterEmail)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("scenario 7: show password and password manager", () => {
  it("Show reveals the password and Hide hides it again", async () => {
    await renderScreen(jest.fn());
    expect(screen.getByTestId("sign-in-password").props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByTestId("sign-in-password").props.secureTextEntry).toBe(false);
    expect(screen.getByText("Hide")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByTestId("sign-in-password").props.secureTextEntry).toBe(true);
  });

  it("both fields carry the autofill hints a password manager needs", async () => {
    await renderScreen(jest.fn());
    const email = screen.getByTestId("sign-in-email").props;
    expect(email).toMatchObject({
      autoComplete: "username",
      textContentType: "username",
      importantForAutofill: "yes",
      keyboardType: "email-address",
      autoCapitalize: "none",
      autoCorrect: false,
    });
    const password = screen.getByTestId("sign-in-password").props;
    expect(password).toMatchObject({ autoComplete: "password", textContentType: "password", importantForAutofill: "yes", autoCapitalize: "none" });
  });

  it("an autofilled value (changeText from the autofill service) is accepted and signs in", async () => {
    const fetchImpl = jest.fn(async () => json({
      access_token: "a", token_type: "bearer", expires_in: 900, refresh_token: "r".repeat(30), refresh_expires_at: "2027-01-01T00:00:00Z",
      session_id: "7b0d8f2e-3c3a-4d57-9c53-0a1b2c3d4e5f", user: DAN,
    }, 201));
    const manager = await renderScreen(fetchImpl);
    await typeCredentials("painter@jobproof.test", "Painter123!");
    await submit();
    await waitFor(() => expect(manager.status).toBe("signed_in"));
    expect(secrets().get("jobproof.refresh_token.v1")).toBe("r".repeat(30));
  });
});

describe("accessibility and large text", () => {
  it("fields are labelled, errors are announced, and nothing has a fixed height that large text could clip", async () => {
    await renderScreen(jest.fn());
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    await submit();
    const error = await screen.findByText(MSG.enterEmail);
    expect(error.props.accessibilityLiveRegion).toBe("polite");
    for (const id of ["sign-in-email", "sign-in-password"]) {
      const style = ([] as object[]).concat(screen.getByTestId(id).props.style).flat() as { height?: number; minHeight?: number }[];
      expect(style.some((s) => s?.height !== undefined)).toBe(false);
      expect(style.some((s) => (s?.minHeight ?? 0) >= 48)).toBe(true);
    }
    for (const id of ["sign-in-email", "sign-in-password"]) expect(screen.getByTestId(id).props.allowFontScaling).not.toBe(false);
  });
});

describe("error states", () => {
  it.each([
    ["scenario 2: wrong password (401)", () => problemResponse(401, "invalid_credentials"), MSG.invalidCredentials, true],
    ["scenario 3: operatives only (403)", () => problemResponse(403, "operatives_only"), MSG.operativesOnly, true],
    ["rate limit from the API (429)", () => problemResponse(429, "rate_limited"), MSG.rateLimited, false],
    ["rate limit from the firewall (bare 403)", () => new Response("Forbidden", { status: 403 }), MSG.rateLimited, false],
    ["server error (500)", () => problemResponse(500, "boom"), MSG.unexpected, false],
    ["app too old (426)", () => problemResponse(426, "app_update_required"), MSG.updateRequired, false],
  ])("%s", async (_name, answer, message, clearsPassword) => {
    const fetchImpl = jest.fn(async () => answer());
    const manager = await renderScreen(fetchImpl);
    await typeCredentials("painter@jobproof.test", "Painter123!");
    await submit();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByTestId("sign-in-email").props.value).toBe("painter@jobproof.test");
    expect(screen.getByTestId("sign-in-password").props.value).toBe(clearsPassword ? "" : "Painter123!");
    expect(manager.status).toBe("signed_out");
    expect(secrets().has("jobproof.refresh_token.v1")).toBe(false);
  });

  it("scenario 12: no signal says so, keeps what was typed, and a retry works once the signal is back", async () => {
    let online = false;
    const fetchImpl = jest.fn(async () => {
      if (!online) throw new TypeError("Network request failed");
      return problemResponse(401, "invalid_credentials");
    });
    await renderScreen(fetchImpl);
    await typeCredentials("painter@jobproof.test", "Painter123!");
    await submit();
    expect(await screen.findByText("No signal. Sign in needs a connection.")).toBeTruthy();
    expect(screen.getByTestId("sign-in-password").props.value).toBe("Painter123!");
    online = true;
    await submit();
    expect(await screen.findByText(MSG.invalidCredentials)).toBeTruthy();
    expect(screen.queryByText(MSG.noSignal)).toBeNull();
  });

  it("the previous error is cleared when the next attempt starts", async () => {
    let n = 0;
    const fetchImpl = jest.fn(async () => (n++ === 0 ? problemResponse(401, "invalid_credentials") : problemResponse(500, "boom")));
    await renderScreen(fetchImpl);
    await typeCredentials("a@b.test", "pw");
    await submit();
    await screen.findByText(MSG.invalidCredentials);
    await typeCredentials("", "pw2");
    await submit();
    await screen.findByText(MSG.unexpected);
    expect(screen.queryByText(MSG.invalidCredentials)).toBeNull();
  });

  it("a second tap while the request is running sends nothing more", async () => {
    let release: () => void = () => undefined;
    const fetchImpl = jest.fn(
      () => new Promise<Response>((resolve) => (release = () => resolve(problemResponse(401, "invalid_credentials")))),
    );
    await renderScreen(fetchImpl);
    await typeCredentials("a@b.test", "pw");
    await submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "Signing in" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Signing in" }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Signing in" }));
    release();
    await screen.findByText(MSG.invalidCredentials);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("notices from the session", () => {
  it.each([
    ["inactive" as const, MSG.accountInactive],
    ["needs_sign_in" as const, MSG.sessionEnded],
  ])("%s shows its message above the form", async (status, message) => {
    const manager = await renderScreen(jest.fn());
    // Drive the manager into the state the way the app does: a refresh the server refuses.
    secrets().set("jobproof.refresh_token.v1", "stale-token-value-0000000000");
    const fetchImpl = jest.fn(async () => problemResponse(401, status === "inactive" ? "account_inactive" : "session_ended"));
    configureApiClient({ baseUrl: "http://api.test", fetch: fetchImpl as unknown as typeof fetch, ...sessionApiOptions(manager) });
    await manager.refresh();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByTestId("session-notice")).toBeTruthy();
  });
});
