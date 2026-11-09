import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureApiClient, queryKeys } from "@jobproof/shared";
import { SessionManager } from "../../api/sessionManager";
import { sessionApiOptions } from "../../api/sessionClient";
import { DAN, MemorySecrets, PRIYA, memoryUserCache, scriptedApi, session, json } from "../../../test/helpers";
import { SessionProvider } from "./SessionProvider";
import { SignOutControl } from "./SignOutControl";
import { UnsentItemsContext, type UnsentItemsSource } from "./unsent";

/** Fixture of local rows, keyed by owner as the T-003e database will be. */
function fixtureRows(photos: { owner_user_id: string; id: string }[]) {
  const rows = [...photos];
  const source: UnsentItemsSource & { rows: typeof rows; queryFor: (user: string) => typeof rows } = {
    rows,
    summaryFor: (userId) => ({ photos: rows.filter((r) => r.owner_user_id === userId).length, reports: 0 }),
    queryFor: (userId) => rows.filter((r) => r.owner_user_id === userId),
  };
  return source;
}
const fourPhotosFor = (owner: string) => Array.from({ length: 4 }, (_, i) => ({ owner_user_id: owner, id: `p${i}` }));

const clients: QueryClient[] = [];
const managers: SessionManager[] = [];
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
  managers.splice(0).forEach((m) => m.dispose());
});

async function renderSignedIn(source: UnsentItemsSource, user = DAN) {
  const fake = scriptedApi();
  fake.script.create = async () => session(1, user);
  const secrets = new MemorySecrets();
  const users = memoryUserCache();
  const manager = new SessionManager({ secrets, api: fake.api, userCache: users, appVersion: "0.1.0" });
  managers.push(manager);
  await manager.signIn(user.email, "pw");
  const client = new QueryClient();
  clients.push(client);
  configureApiClient({ baseUrl: "http://api.test", fetch: (async () => json({})) as unknown as typeof fetch, ...sessionApiOptions(manager) });
  await render(
    <SessionProvider manager={manager}>
      <QueryClientProvider client={client}>
        <UnsentItemsContext.Provider value={source}>
          <SignOutControl />
        </UnsentItemsContext.Provider>
      </QueryClientProvider>
    </SessionProvider>,
  );
  return { manager, secrets, users, client, fake };
}

describe("scenario 8: nothing waiting", () => {
  it("asks once, then ends the session, clears the tokens and the cached user data", async () => {
    const t = await renderSignedIn(fixtureRows([]));
    t.client.setQueryData(["operative", "jobs"], [{ id: "j1" }]);
    t.client.setQueryData(queryKeys.me, DAN);
    t.client.setQueryData(queryKeys.branding, { company_name: "Test Services" });
    await fireEvent.press(screen.getByTestId("sign-out"));
    expect(await screen.findByTestId("sign-out-confirm")).toBeTruthy();
    expect(screen.queryByTestId("sign-out-unsent")).toBeNull();
    expect(t.manager.status).toBe("signed_in"); // nothing happens until confirmed
    await fireEvent.press(screen.getByTestId("sign-out-confirm-yes"));
    await waitFor(() => expect(t.manager.status).toBe("signed_out"));
    expect(t.secrets.token).toBeNull();
    expect(t.manager.accessTokenStore.get()).toBeNull();
    expect(t.users.user).toBeUndefined();
    expect(t.fake.calls.end).toBe(1);
    expect(t.client.getQueryData(["operative", "jobs"])).toBeUndefined();
    expect(t.client.getQueryData(queryKeys.me)).toBeUndefined();
    expect(t.client.getQueryData(queryKeys.branding)).toEqual({ company_name: "Test Services" }); // public
  });
});

describe("scenario 9: unsent items", () => {
  it("shows the count, defaults to Stay signed in, and Stay changes nothing", async () => {
    const source = fixtureRows(fourPhotosFor(DAN.id));
    const t = await renderSignedIn(source);
    await fireEvent.press(screen.getByTestId("sign-out"));
    const message = await screen.findByTestId("sign-out-unsent-message");
    expect(message.props.children).toBe("4 photos haven't reached the office yet. Stay signed in so they can send.");
    expect(screen.queryByTestId("sign-out-confirm")).toBeNull();
    const buttons = screen.getAllByRole("button").map((b) => b.props.accessibilityLabel as string);
    expect(buttons.indexOf("Stay signed in")).toBeLessThan(buttons.indexOf("Sign out anyway")); // the safe choice comes first
    await fireEvent.press(screen.getByTestId("sign-out-stay"));
    await waitFor(() => expect(screen.queryByTestId("sign-out-unsent")).toBeNull());
    expect(t.manager.status).toBe("signed_in");
    expect(t.secrets.token).not.toBeNull();
    expect(source.rows).toHaveLength(4);
  });

  it("the Android back button on the dialog means Stay signed in", async () => {
    const t = await renderSignedIn(fixtureRows(fourPhotosFor(DAN.id)));
    await fireEvent.press(screen.getByTestId("sign-out"));
    await screen.findByTestId("sign-out-unsent");
    // Walk up from the dialog card to the Modal host, which carries onRequestClose (the back button).
    let node = screen.getByTestId("sign-out-unsent") as unknown as { props: { onRequestClose?: () => void }; parent: unknown };
    while (node && !node.props.onRequestClose) node = node.parent as typeof node;
    expect(node).toBeTruthy();
    await act(async () => node.props.onRequestClose!());
    await waitFor(() => expect(screen.queryByTestId("sign-out-unsent")).toBeNull());
    expect(t.manager.status).toBe("signed_in");
  });

  it("Sign out anyway ends the session but keeps all 4 rows under Dan's id", async () => {
    const source = fixtureRows(fourPhotosFor(DAN.id));
    const t = await renderSignedIn(source);
    await fireEvent.press(screen.getByTestId("sign-out"));
    await fireEvent.press(await screen.findByTestId("sign-out-anyway"));
    await waitFor(() => expect(t.manager.status).toBe("signed_out"));
    expect(t.secrets.token).toBeNull();
    expect(source.rows).toHaveLength(4);
    expect(source.queryFor(DAN.id)).toHaveLength(4);
  });

  it("a count that cannot be read is treated as work waiting, never as nothing", async () => {
    const t = await renderSignedIn({
      summaryFor: () => {
        throw new Error("db locked");
      },
    });
    await fireEvent.press(screen.getByTestId("sign-out"));
    expect(await screen.findByTestId("sign-out-unsent")).toBeTruthy();
    expect(t.manager.status).toBe("signed_in");
  });
});

describe("scenario 10: another operative on the same phone", () => {
  it("Priya sees none of Dan's rows, and Dan's 4 remain until Dan signs in again", async () => {
    const source = fixtureRows(fourPhotosFor(DAN.id));
    const dan = await renderSignedIn(source);
    await fireEvent.press(screen.getByTestId("sign-out"));
    await fireEvent.press(await screen.findByTestId("sign-out-anyway"));
    await waitFor(() => expect(dan.manager.status).toBe("signed_out"));

    expect(source.queryFor(PRIYA.id)).toEqual([]);
    expect(source.summaryFor(PRIYA.id)).toEqual({ photos: 0, reports: 0 });
    expect(source.queryFor(DAN.id)).toHaveLength(4);
    expect(source.summaryFor(DAN.id)).toEqual({ photos: 4, reports: 0 });
  });

  it("Priya, signing out with nothing of her own waiting, is not asked about Dan's photos", async () => {
    const source = fixtureRows(fourPhotosFor(DAN.id));
    await renderSignedIn(source, PRIYA);
    await fireEvent.press(screen.getByTestId("sign-out"));
    expect(await screen.findByTestId("sign-out-confirm")).toBeTruthy();
    expect(screen.queryByTestId("sign-out-unsent")).toBeNull();
  });
});
