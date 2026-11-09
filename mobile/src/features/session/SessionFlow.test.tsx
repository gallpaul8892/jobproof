import { callApi } from "@jobproof/shared";
import { act, fireEvent, screen, waitFor, within } from "expo-router/testing-library";
import { cleanupLaunched, launch } from "../../../test/harness";
import { fakeServer } from "../../../test/fakeServer";
import { DAN, getMe } from "../../../test/helpers";
import { REFRESH_TOKEN_KEY } from "../../api/secureTokenStore";
import { USER_KEY } from "../../api/userCache";
import { MSG } from "./messages";

const secrets = () => (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
const kv = () => (globalThis as unknown as { __kvStore: Map<string, string> }).__kvStore;

afterEach(cleanupLaunched);

async function signInAs(email: string, password: string) {
  await fireEvent.changeText(await screen.findByTestId("sign-in-email"), email);
  await fireEvent.changeText(screen.getByTestId("sign-in-password"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
}

describe("scenario 1: successful sign-in", () => {
  it("lands on My jobs and the header shows Dan Hughes; the refresh token is in the secure store", async () => {
    const server = fakeServer();
    await launch(server);
    expect(await screen.findByTestId("sign-in-screen")).toBeTruthy();
    await signInAs("painter@jobproof.test", "Painter123!");
    expect(await screen.findByTestId("my-jobs-screen")).toBeTruthy();
    expect(screen.getByText("My jobs")).toBeTruthy();
    expect(screen.getByTestId("user-name").props.children).toBe("Dan Hughes");
    expect(screen.queryByTestId("sign-in-screen")).toBeNull();
    expect(secrets().get(REFRESH_TOKEN_KEY)).toMatch(/^refresh-/);
    const body = server.requests.find((r) => r.path === "/auth/sessions")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ platform: "android", app_version: "0.1.0", email: "painter@jobproof.test" });
    expect(body.device_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("scenario 2: wrong password", () => {
  it("shows the message, keeps the email, clears the password, stays on sign-in", async () => {
    await launch(fakeServer());
    await signInAs("painter@jobproof.test", "wrong");
    expect(await screen.findByText("Email or password is incorrect.")).toBeTruthy();
    expect(screen.getByTestId("sign-in-email").props.value).toBe("painter@jobproof.test");
    expect(screen.getByTestId("sign-in-password").props.value).toBe("");
    expect(screen.queryByTestId("my-jobs-screen")).toBeNull();
    expect(secrets().size).toBe(1); // only the device id
  });
});

describe("scenario 3: manager or admin account", () => {
  it.each([
    ["manager@jobproof.test", "Manager123!"],
    ["admin@jobproof.test", "Admin123!"],
  ])("%s sees the operatives-only message and nothing is kept", async (email, password) => {
    await launch(fakeServer());
    await signInAs(email, password);
    expect(await screen.findByText(MSG.operativesOnly)).toBeTruthy();
    expect(secrets().has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(kv().has(USER_KEY)).toBe(false);
    expect(screen.queryByTestId("my-jobs-screen")).toBeNull();
  });
});

/** What a previous run of the app left on the phone: the refresh token in the secure store, the cached user. */
function leftBehindByEarlierRun(server: ReturnType<typeof fakeServer>) {
  const refresh = server.seedSession(DAN, "99999999-9999-4999-8999-999999999999");
  secrets().set(REFRESH_TOKEN_KEY, refresh);
  kv().set(USER_KEY, JSON.stringify(DAN));
  return refresh;
}

describe("scenario 5: session survives a restart", () => {
  it("a launch with the stored refresh token goes straight to My jobs without typing anything", async () => {
    const server = fakeServer();
    const stored = leftBehindByEarlierRun(server);
    await launch(server);
    expect(await screen.findByTestId("my-jobs-screen")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-email")).toBeNull();
    expect(screen.getByTestId("user-name").props.children).toBe("Dan Hughes");
    await waitFor(() => expect(secrets().get(REFRESH_TOKEN_KEY)).not.toBe(stored)); // rotated
    expect(server.requests.filter((r) => r.path === "/auth/sessions/refresh")).toHaveLength(1);
  });

  it("with no signal after a restart Dan is still signed in, and the reachability screen never blocks him (scenario 12)", async () => {
    const server = fakeServer();
    const stored = leftBehindByEarlierRun(server);
    server.offline = true;
    await launch(server);
    expect(await screen.findByTestId("my-jobs-screen")).toBeTruthy();
    expect(screen.getByTestId("user-name").props.children).toBe("Dan Hughes");
    expect(screen.queryByTestId("unreachable")).toBeNull();
    expect(secrets().get(REFRESH_TOKEN_KEY)).toBe(stored);
  });

  it("when the server has ended the session the operative is asked to sign in again", async () => {
    const server = fakeServer();
    leftBehindByEarlierRun(server);
    server.sessions.clear();
    await launch(server);
    expect(await screen.findByText(MSG.sessionEnded)).toBeTruthy();
    expect(screen.getByTestId("sign-in-screen")).toBeTruthy();
    expect(secrets().has(REFRESH_TOKEN_KEY)).toBe(false);
  });
});

describe("scenario 8: sign-out with nothing waiting", () => {
  it("confirm, end the session on the server, clear tokens and cached data, return to sign-in", async () => {
    const server = fakeServer();
    const { client } = await launch(server);
    await signInAs("painter@jobproof.test", "Painter123!");
    await screen.findByTestId("my-jobs-screen");
    client.setQueryData(["operative", "jobs"], [{ id: "job-1", customer: "Mrs Patel" }]);
    kv().set("jobproof.branding.v1", kv().get("jobproof.branding.v1") ?? "{}");

    await fireEvent.press(screen.getByTestId("open-settings"));
    await fireEvent.press(await screen.findByTestId("sign-out"));
    const dialog = await screen.findByTestId("sign-out-confirm");
    expect(within(dialog).getByText("Sign out?")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("sign-out-confirm-yes"));

    expect(await screen.findByTestId("sign-in-screen")).toBeTruthy();
    expect(secrets().has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(kv().has(USER_KEY)).toBe(false);
    expect(client.getQueryData(["operative", "jobs"])).toBeUndefined();
    expect(server.requests.some((r) => r.method === "DELETE" && r.path === "/auth/sessions/current")).toBe(true);
    expect(server.sessionRows().every((s) => s.revoked)).toBe(true);
    expect(screen.queryByText("Dan Hughes")).toBeNull();
  });

  it("Cancel keeps Dan signed in", async () => {
    await launch(fakeServer());
    await signInAs("painter@jobproof.test", "Painter123!");
    await fireEvent.press(await screen.findByTestId("open-settings"));
    await fireEvent.press(await screen.findByTestId("sign-out"));
    await fireEvent.press(await screen.findByTestId("sign-out-cancel"));
    expect(screen.queryByTestId("sign-in-screen")).toBeNull();
    expect(secrets().has(REFRESH_TOKEN_KEY)).toBe(true);
  });
});

describe("scenario 11: account deactivated", () => {
  it("the next contact with the server returns Dan to sign-in with the message; local rows are untouched", async () => {
    const server = fakeServer();
    const rows = [{ owner_user_id: DAN.id, id: "photo-1" }];
    await launch(server);
    await signInAs("painter@jobproof.test", "Painter123!");
    await screen.findByTestId("my-jobs-screen");

    server.deactivate(DAN);
    await act(async () => {
      await callApi(() => getMe()).catch(() => undefined);
    });

    expect(await screen.findByText(MSG.accountInactive)).toBeTruthy();
    expect(screen.getByTestId("sign-in-screen")).toBeTruthy();
    expect(screen.queryByTestId("my-jobs-screen")).toBeNull();
    expect(secrets().has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(rows).toEqual([{ owner_user_id: DAN.id, id: "photo-1" }]); // nothing deletes local rows
    await waitFor(() => expect(server.requests.filter((r) => r.path === "/auth/sessions/refresh")).toHaveLength(1));
  });
});

describe("route guard", () => {
  it("a signed-out visit to a signed-in route shows sign-in, never the screen", async () => {
    await launch(fakeServer());
    expect(await screen.findByTestId("sign-in-screen")).toBeTruthy();
    expect(screen.queryByTestId("my-jobs-screen")).toBeNull();
  });
});
