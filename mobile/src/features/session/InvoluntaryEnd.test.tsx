import { callApi } from "@jobproof/shared";
import { act, screen, waitFor } from "expo-router/testing-library";
import { cleanupLaunched, launch } from "../../../test/harness";
import { fakeServer } from "../../../test/fakeServer";
import { DAN, getMe } from "../../../test/helpers";
import { EXTERIOR, LOUNGE, WALL, list } from "../../../test/jobFixtures";
import { kv, launchSignedIn, persistedKey } from "../../../test/signedIn";
import { makeTestStore } from "../../../test/support/store";
import { SqliteUnsentItemsSource } from "../../db/unsentSource";
import { MSG } from "./messages";

afterEach(cleanupLaunched);

/** Dan has unsent work on the phone: the thing an involuntary sign-out must never touch. */
async function danHasUnsentWork() {
  const t = makeTestStore();
  const r = await t.store.capture.saveShot({ ownerUserId: DAN.id, jobId: "job-lounge", stage: "before" }, { uri: t.files.seed("file:///cache/a.jpg", "evidence"), width: 1, height: 1 });
  if (!r.ok) throw new Error(r.message);
  await t.store.capture.idle();
  t.db.run("UPDATE drafts SET notes = 'Mrs Patel wants the hall done first', notes_rev = 1 WHERE owner_user_id = ?", [DAN.id]);
  return { ...t, photoId: r.photo.id };
}

function expectLocalWorkIntact(t: Awaited<ReturnType<typeof danHasUnsentWork>>) {
  expect(t.store.photos.listForJob(DAN.id, "job-lounge").map((p) => p.id)).toEqual([t.photoId]);
  expect(t.files.exists(t.store.photos.get(DAN.id, t.photoId)!.original_path)).toBe(true);
  expect(t.db.get("SELECT notes FROM drafts WHERE owner_user_id = ?", [DAN.id])).toEqual({ notes: "Mrs Patel wants the hall done first" });
  expect(new SqliteUnsentItemsSource(t.db).summaryFor(DAN.id)).toEqual({ photos: 1, reports: 1 });
}

describe("involuntary session end wipes the job cache (customer numbers, addresses, notes) but keeps unsent work", () => {
  it("the server ended the session (cold start): saved list and in-memory data go, photos and drafts stay", async () => {
    const t = await danHasUnsentWork();
    const server = fakeServer();
    server.setJobs(list({ jobs_today: [LOUNGE, WALL, EXTERIOR] }));
    const first = await launchSignedIn(server, DAN, t.store);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });
    await act(async () => screen.unmount());
    cleanupLaunched();
    expect(first.client.getQueryData(["operative", "jobs"])).toBeUndefined(); // new run, new memory

    server.sessions.clear(); // revoked or expired on the server
    const second = await launch(server, undefined, t.store);
    expect(await screen.findByText(MSG.sessionEnded)).toBeTruthy();
    expect(screen.getByTestId("sign-in-screen")).toBeTruthy();

    expect(kv().has(persistedKey(DAN))).toBe(false); // the saved customer data is gone
    expect(second.client.getQueriesData({ queryKey: ["operative"] })).toEqual([]);
    expectLocalWorkIntact(t);
  });

  it("the account was deactivated mid-session: same wipe, local work kept", async () => {
    const t = await danHasUnsentWork();
    const server = fakeServer();
    server.setJobs(list({ jobs_today: [LOUNGE, WALL, EXTERIOR] }));
    const { client } = await launchSignedIn(server, DAN, t.store);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });
    expect(client.getQueryData(["operative", "jobs"])).toBeDefined();

    server.deactivate(DAN);
    await act(async () => {
      await callApi(() => getMe()).catch(() => undefined);
    });

    expect(await screen.findByText(MSG.accountInactive)).toBeTruthy();
    expect(kv().has(persistedKey(DAN))).toBe(false);
    expect(client.getQueriesData({ queryKey: ["operative"] })).toEqual([]);
    expectLocalWorkIntact(t);
  });

  it("the stored list is not written back after the wipe", async () => {
    const t = await danHasUnsentWork();
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server, DAN, t.store);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });
    server.deactivate(DAN);
    await act(async () => {
      await callApi(() => getMe()).catch(() => undefined);
    });
    await screen.findByTestId("sign-in-screen");
    // Longer than the persister's write delay; a stray save would land in this window.
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(kv().has(persistedKey(DAN))).toBe(false);
  }, 20_000);

  it("losing signal is NOT an involuntary end: the saved list stays for offline use", async () => {
    const t = makeTestStore();
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server, DAN, t.store);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });
    server.offline = true;
    await act(async () => {
      await callApi(() => getMe()).catch(() => undefined);
    });
    expect(kv().has(persistedKey(DAN))).toBe(true);
    expect(screen.queryByTestId("sign-in-screen")).toBeNull();
  });
});
