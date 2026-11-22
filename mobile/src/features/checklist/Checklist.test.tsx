import { router } from "expo-router";
import { act, fireEvent, screen, waitFor, within } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import type { OperativeJob } from "@jobproof/shared";
import { cleanupLaunched } from "../../../test/harness";
import { fakeServer } from "../../../test/fakeServer";
import { DAN } from "../../../test/helpers";
import { LOUNGE, checklist, list, makeJob } from "../../../test/jobFixtures";
import { launchSignedIn } from "../../../test/signedIn";
import { makeTestStore, type TestStore } from "../../../test/support/store";
import { CHECKLIST_MSG } from "./messages";

afterEach(() => {
  jest.restoreAllMocks();
  cleanupLaunched();
});

const J = "job-lounge";
const item = (n: number) => `${J}-item-${n}`;
const rows = (t: TestStore) => t.store.drafts.checklist(DAN.id, J);

function serverWith(...jobs: OperativeJob[]) {
  const server = fakeServer();
  server.setJobs(list({ jobs_today: jobs }));
  return server;
}

async function openJob(t: TestStore = makeTestStore(), server = serverWith(LOUNGE)) {
  await launchSignedIn(server, DAN, t.store);
  await screen.findByTestId("jobs-today");
  await fireEvent.press(screen.getByTestId(`job-row-${J}`));
  await screen.findByTestId("job-screen");
  return { t, server };
}
const openItem = async (n: number) => {
  await fireEvent.press(screen.getByTestId(`checklist-open-${item(n)}`));
  await screen.findByTestId("item-screen");
};
const backToJob = async () => {
  await fireEvent.press(screen.getByTestId("item-back"));
  await screen.findByTestId("job-screen");
};
const type = async (testID: string, text: string) => {
  await fireEvent.changeText(screen.getByTestId(testID), text);
};
/** Time passing for the 500 ms autosave (the router test renderer runs on fake timers). */
const pause = (ms: number) => act(async () => void (await jest.advanceTimersByTimeAsync(ms)));
const summary = () => screen.getByTestId("checklist-summary");
const state = (n: number) => screen.getByTestId(`checklist-state-${item(n)}`);

describe("T-003f scenario 1: tick an item", () => {
  it("a tap ticks it, the summary reads '1 of 9 done', and a second tap unticks it", async () => {
    const { t } = await openJob();
    expect(summary()).toHaveTextContent("0 of 9 done");
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    expect(state(1)).toHaveTextContent("Done");
    expect(summary()).toHaveTextContent("1 of 9 done");
    expect(screen.getByTestId(`checklist-toggle-${item(1)}`).props.accessibilityState).toMatchObject({ checked: true });
    expect(rows(t)).toMatchObject([{ item_id: item(1), status: "done", rev: 1, synced_rev: 0 }]);

    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    expect(state(1)).toHaveTextContent("Not done yet");
    expect(summary()).toHaveTextContent("0 of 9 done");
    expect(rows(t)[0]).toMatchObject({ status: "open", rev: 2 });
  });

  it("the job becomes 'In progress, 1 of 9 done' straight away, with no signal needed and no Save button", async () => {
    const { server } = await openJob();
    server.offline = true;
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    expect(screen.getByTestId("job-status-text")).toHaveTextContent("In progress, 1 of 9 done");
    expect(screen.queryByText(/^Save$/)).toBeNull();
  });

  it("each row is labelled for TalkBack and has a 48 dp+ target for ticking and for details", async () => {
    await openJob();
    const toggle = screen.getByTestId(`checklist-toggle-${item(2)}`);
    expect(toggle.props.accessibilityRole).toBe("checkbox");
    expect(toggle.props.accessibilityLabel).toBe("Item 2 of 9. Ceilings painted, two coats. Not done yet.");
    expect(StyleSheet.flatten(toggle.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(StyleSheet.flatten(screen.getByTestId(`checklist-open-${item(2)}`).props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(screen.getByTestId(`checklist-open-${item(2)}`).props.accessibilityLabel).toBe("Details for Ceilings painted, two coats");
  });

  it("a submitted job's checklist cannot be ticked", async () => {
    const submitted = makeJob({ ...LOUNGE, status: "submitted", report: { id: "r", state: "submitted", notes: null, submitted_at: "2026-11-09T09:00:00Z" } as never });
    const { t } = await openJob(makeTestStore(), serverWith(submitted));
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    expect(rows(t)).toEqual([]);
    expect(screen.queryByTestId("report-notes-input")).toBeNull();
  });
});

describe("T-003f scenario 2: a note on an item", () => {
  it("is saved as typed, shows under the item, and is kept after leaving the screen and returning", async () => {
    const { t } = await openJob();
    await openItem(3);
    await type("item-note-input", "Needs second coat on window wall");
    await waitFor(() => expect(rows(t)).toMatchObject([{ item_id: item(3), note: "Needs second coat on window wall", rev: 1 }]));
    await backToJob();
    expect(screen.getByTestId(`checklist-note-${item(3)}`)).toHaveTextContent("Needs second coat on window wall");
    await openItem(3);
    expect(screen.getByTestId("item-note-input").props.value).toBe("Needs second coat on window wall");
  });

  it("leaving straight away still saves what was just typed (no Save button)", async () => {
    const { t } = await openJob();
    await openItem(3);
    await type("item-note-input", "Typed and left at once");
    await fireEvent.press(screen.getByTestId("item-back"));
    await screen.findByTestId("job-screen");
    expect(rows(t)[0]).toMatchObject({ note: "Typed and left at once" });
  });
});

describe("T-003f scenario 3: item not done, with a reason", () => {
  it("shows 'Not done: add a reason' and counts as incomplete until a reason is given", async () => {
    const { t } = await openJob();
    await openItem(8);
    await fireEvent.press(screen.getByTestId("item-cant-do"));
    expect(screen.getByTestId("item-state")).toHaveTextContent("Not done: add a reason");
    expect(screen.getByTestId("item-reason-help")).toBeTruthy();
    expect(screen.getByTestId("item-note-input").props.accessibilityLabel).toBe("Why can't you do this?");
    await backToJob();
    expect(state(8)).toHaveTextContent("Not done: add a reason");
    expect(summary()).toHaveTextContent("0 of 9 done");
    expect(rows(t)[0]).toMatchObject({ status: "not_done", note: null });
  });

  it("with the reason it reads 'Not done: Customer already took the tin' and counts as dealt with", async () => {
    const { t } = await openJob();
    await openItem(8);
    await fireEvent.press(screen.getByTestId("item-cant-do"));
    await type("item-note-input", "Customer already took the tin");
    await waitFor(() => expect(rows(t)[0]).toMatchObject({ status: "not_done", note: "Customer already took the tin" }));
    expect(screen.getByTestId("item-state")).toHaveTextContent("Not done: Customer already took the tin");
    await backToJob();
    expect(state(8)).toHaveTextContent("Not done: Customer already took the tin");
    expect(summary()).toHaveTextContent("1 of 9 done");
  });

  it("'Can't do this' and 'Done' are two exclusive choices, and tapping the chosen one again clears it", async () => {
    const { t } = await openJob();
    await openItem(1);
    await fireEvent.press(screen.getByTestId("item-done"));
    expect(screen.getByTestId("item-done").props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId("item-cant-do"));
    expect(screen.getByTestId("item-done").props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId("item-cant-do").props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId("item-cant-do"));
    expect(rows(t)[0]).toMatchObject({ status: "open" });
  });
});

describe("T-003f scenarios 4 and 5: photos on an item", () => {
  async function takePhotoOn(t: TestStore, n: number, over: { source?: "gallery" } = {}) {
    const r = await t.store.capture.saveShot({ ownerUserId: DAN.id, jobId: J, stage: "during", itemId: item(n) }, { uri: t.files.seed(`file:///cache/p-${n}.jpg`), width: 1, height: 1 });
    if (!r.ok) throw new Error(r.message);
    if (over.source) t.db.run("UPDATE photos SET source = 'gallery' WHERE id = ?", [r.photo.id]);
    await t.store.capture.idle();
    return r.photo;
  }

  it("'Add photo' opens the camera for that item, and the photo lands under the item, once in its stage group, and the row says '1 photo'", async () => {
    const t = makeTestStore();
    let n = 0;
    await openJob(t);
    await openItem(4);
    (globalThis as unknown as { __camera: { takePicture: () => Promise<unknown> } }).__camera.takePicture = async () => ({ uri: t.files.seed(`file:///cache/shot-${++n}.jpg`, `shot-${n}`), width: 4000, height: 3000 });
    expect(screen.getByTestId("item-photo-count")).toHaveTextContent("0 photos");
    await fireEvent.press(screen.getByTestId("item-add-photo"));
    await screen.findByTestId("camera-screen");
    await fireEvent.press(screen.getByTestId("shutter"));
    await waitFor(() => expect(t.store.photos.listForJob(DAN.id, J)).toHaveLength(1));
    expect(t.store.photos.listForJob(DAN.id, J)[0]).toMatchObject({ checklist_item_id: item(4), source: "camera" });
    await act(async () => {
      await t.store.capture.idle();
    });
    await fireEvent.press(screen.getByTestId("camera-done"));
    await screen.findByTestId("item-screen");
    expect(screen.getByTestId("item-photo-count")).toHaveTextContent("1 photo");
    const [photo] = t.store.photos.listForJob(DAN.id, J);
    expect(within(screen.getByTestId(`item-photo-${photo!.id}`)).getByTestId(`photo-${photo!.id}`)).toBeTruthy();
    await backToJob();
    expect(screen.getByTestId(`checklist-photos-${item(4)}`)).toHaveTextContent("1 photo");
    expect(screen.getAllByTestId(`photo-${photo!.id}`)).toHaveLength(1); // once, in its stage group
    expect(within(screen.getByTestId(`photo-group-${photo!.stage}`)).getByTestId(`photo-${photo!.id}`)).toBeTruthy();
  });

  it("a gallery photo added to an item shows 'From gallery' under it", async () => {
    const t = makeTestStore();
    await openJob(t);
    await openItem(2);
    t.picker.next = [{ uri: t.files.seed("file:///gallery/old.jpg", "old"), width: 4000, height: 3000, type: "image", mimeType: "image/jpeg", fileName: "old.jpg", exif: null }];
    await fireEvent.press(screen.getByTestId("item-gallery"));
    await screen.findByTestId("gallery-stage-dialog");
    await fireEvent.press(screen.getByTestId("gallery-stage-add"));
    await waitFor(() => expect(t.store.photos.listForJob(DAN.id, J)).toHaveLength(1));
    const [p] = t.store.photos.listForJob(DAN.id, J);
    expect(p).toMatchObject({ source: "gallery", checklist_item_id: item(2) });
    expect(await screen.findByTestId(`photo-gallery-${p!.id}`)).toHaveTextContent("From gallery");
    expect(screen.getByTestId("item-photo-count")).toHaveTextContent("1 photo");
  });

  it("scenario 6: moving a photo to another item changes the item in place: no duplicate, nothing to re-upload", async () => {
    const t = makeTestStore();
    const { server } = await openJob(t);
    const photo = await takePhotoOn(t, 3);
    await openItem(3);
    await fireEvent.press(screen.getByTestId(`item-move-${photo.id}`));
    const picker = await screen.findByTestId("item-picker");
    expect(within(picker).queryByTestId(`item-picker-${item(3)}`)).toBeNull(); // not the item it is on
    await fireEvent.press(screen.getByTestId(`item-picker-${item(5)}`));
    const after = t.store.photos.listForJob(DAN.id, J);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: photo.id, checklist_item_id: item(5), meta_rev: 2, sync_state: "saved" });
    expect(screen.getByTestId("item-photo-count")).toHaveTextContent("0 photos");
    expect(server.requests.filter((r) => r.path.includes("/photos"))).toEqual([]);
    await backToJob();
    expect(screen.getByTestId(`checklist-photos-${item(5)}`)).toHaveTextContent("1 photo");
    expect(screen.queryByTestId(`checklist-photos-${item(3)}`)).toBeNull();
  });

  it("a photo can be taken off its item, and a full item (12) refuses another with its message", async () => {
    const t = makeTestStore();
    await openJob(t);
    const first = await takePhotoOn(t, 3);
    for (let i = 0; i < 12; i++) await takePhotoOn(t, 5);
    await openItem(3);
    await fireEvent.press(screen.getByTestId(`item-move-${first.id}`));
    await fireEvent.press(await screen.findByTestId(`item-picker-${item(5)}`));
    expect(screen.getByTestId("item-problem-text")).toHaveTextContent("This item has the maximum 12 photos.");
    await fireEvent.press(screen.getByTestId(`item-move-${first.id}`));
    await fireEvent.press(await screen.findByTestId("item-picker-none"));
    expect(t.store.photos.get(DAN.id, first.id)?.checklist_item_id).toBeNull();
  });
});

describe("T-003f scenario 7: overall job notes", () => {
  it("are saved as the job note, 500 ms after typing, with no Save button", async () => {
    const { t } = await openJob();
    const text = "All rooms done. Customer happy. 2 litres Dulux Chalk White left in the garage.";
    await type("report-notes-input", text);
    expect(t.store.drafts.draft(DAN.id, J)?.notes_rev ?? 0).toBe(0); // not yet: debounced
    await waitFor(() => expect(t.store.drafts.draft(DAN.id, J)).toMatchObject({ notes: text, notes_rev: 1 }));
    expect(screen.queryByText(/^Save$/)).toBeNull();
  });

  it("keeps line breaks and accepts exactly 2,000 characters", async () => {
    const { t } = await openJob();
    await type("report-notes-input", "Line one\nLine two");
    await waitFor(() => expect(t.store.drafts.draft(DAN.id, J)?.notes).toBe("Line one\nLine two"));
    await type("report-notes-input", "x".repeat(2000));
    await waitFor(() => expect(t.store.drafts.draft(DAN.id, J)?.notes).toHaveLength(2000));
  });

  it("scenario 11: 2,001 characters are refused with the message, the typed text stays, the last good note stays saved", async () => {
    const { t } = await openJob();
    await type("report-notes-input", "Good note");
    await waitFor(() => expect(t.store.drafts.draft(DAN.id, J)?.notes).toBe("Good note"));
    await type("report-notes-input", "y".repeat(2001));
    expect(screen.getByTestId("report-notes-input-error")).toHaveTextContent("Keep it to 2,000 characters.");
    expect(screen.getByTestId("report-notes-input").props.value).toHaveLength(2001);
    await pause(650);
    expect(t.store.drafts.draft(DAN.id, J)?.notes).toBe("Good note");
  });

  it("starts with the note already on the server", async () => {
    await openJob(makeTestStore(), serverWith(makeJob({ ...LOUNGE, status: "in_progress", report: { id: "r", state: "draft", notes: "From the server", submitted_at: null } as never })));
    expect(screen.getByTestId("report-notes-input").props.value).toBe("From the server");
  });
});

describe("T-003f scenario 11: invalid item note", () => {
  it("501 characters are refused with 'Keep it to 500 characters.' and the text is not lost", async () => {
    const { t } = await openJob();
    await openItem(1);
    await type("item-note-input", "z".repeat(501));
    expect(screen.getByTestId("item-note-input-error")).toHaveTextContent("Keep it to 500 characters.");
    expect(screen.getByTestId("item-note-input").props.value).toBe("z".repeat(501));
    await pause(650);
    expect(rows(t)).toEqual([]);
    await type("item-note-input", "z".repeat(500));
    expect(screen.queryByTestId("item-note-input-error")).toBeNull();
    await waitFor(() => expect(rows(t)[0]?.note).toHaveLength(500));
  });
});

describe("T-003f scenario 8: the draft is still there after the app is killed and reopened", () => {
  it("4 ticks and the note come back from the phone's database, with no Save button used", async () => {
    const first = makeTestStore();
    await openJob(first);
    for (const n of [1, 2, 3, 4]) await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(n)}`));
    await type("report-notes-input", "Back tomorrow for the second coat");
    await waitFor(() => expect(first.store.drafts.draft(DAN.id, J)?.notes).toBe("Back tomorrow for the second coat"));
    cleanupLaunched();

    // A new app run over the same database and files.
    const second = makeTestStore({ db: first.db, files: first.files });
    await openJob(second, serverWith(LOUNGE));
    expect(summary()).toHaveTextContent("4 of 9 done");
    expect(screen.getByTestId("report-notes-input").props.value).toBe("Back tomorrow for the second coat");
    expect(screen.getByTestId("job-status-text")).toHaveTextContent("In progress, 4 of 9 done");
  });
});

describe("T-003f scenario 10: the office changes the checklist", () => {
  it("after a refresh the new list shows, ticks on remaining items are kept, and a removed item with data keeps it under 'Other photos and notes'", async () => {
    const t = makeTestStore();
    const server = serverWith(LOUNGE);
    await openJob(t, server);
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(2)}`));
    const photo = (await t.store.capture.saveShot({ ownerUserId: DAN.id, jobId: J, stage: "during", itemId: item(3) }, { uri: t.files.seed("file:///cache/r.jpg"), width: 1, height: 1 }));
    if (!photo.ok) throw new Error(photo.message);
    await t.store.capture.idle();

    // The office removes item 3 (it has a photo) and adds a new one.
    const changed = makeJob({
      ...LOUNGE,
      status: "in_progress",
      checklist: [
        ...checklist(9).filter((i) => i.id !== item(3)),
        { id: "job-lounge-item-new", position: 10, label: "Touch up skirting", status: "open", note: null, removed: false },
        { id: item(3), position: 3, label: "Walls painted, two coats", status: "open", note: "Second coat tomorrow", removed: true },
      ],
      checklist_total: 9,
      checklist_dealt_with: 0,
    });
    server.setJobs(list({ jobs_today: [changed] }));
    const { refreshControl } = screen.getByTestId("job-screen").props;
    await act(async () => {
      await refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(screen.getByTestId("checklist")).toBeTruthy());
    expect(screen.getByTestId(`checklist-item-job-lounge-item-new`)).toBeTruthy();
    expect(screen.queryByTestId(`checklist-item-${item(3)}`)).toBeNull();
    expect(state(1)).toHaveTextContent("Done");
    expect(state(2)).toHaveTextContent("Done");
    expect(summary()).toHaveTextContent("2 of 9 done");
    const other = screen.getByTestId("checklist-other");
    expect(within(other).getByText(CHECKLIST_MSG.otherHeading)).toBeTruthy();
    expect(within(other).getByText("Walls painted, two coats")).toBeTruthy();
    expect(screen.getByTestId(`checklist-other-note-${item(3)}`)).toHaveTextContent("Second coat tomorrow");
    expect(within(other).getByTestId(`photo-${photo.photo.id}`)).toBeTruthy();
  });

  it("an item with no data that the office removed is simply gone", async () => {
    const gone = makeJob({ ...LOUNGE, checklist: checklist(8, J), checklist_total: 8 });
    await openJob(makeTestStore(), serverWith(gone));
    expect(screen.getAllByTestId(/^checklist-item-/)).toHaveLength(8);
    expect(screen.queryByTestId("checklist-other")).toBeNull();
  });
});

describe("T-003f scenario 12: progress is visible in the header and the list", () => {
  it("'6 of 9 done' on the job screen and in My jobs", async () => {
    const t = makeTestStore();
    await openJob(t);
    for (const n of [1, 2, 3, 4, 5, 6]) await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(n)}`));
    expect(summary()).toHaveTextContent("6 of 9 done");
    expect(screen.getByTestId("job-status-text")).toHaveTextContent("In progress, 6 of 9 done");
    await fireEvent.press(screen.getByTestId("job-back"));
    await screen.findByTestId("jobs-today");
    expect(screen.getByTestId(`job-status-${J}-text`)).toHaveTextContent("In progress, 6 of 9 done");
  });
});

describe("the item screen", () => {
  it("shows the position and title, and a job that is not there or an item that is not on it as unavailable", async () => {
    await openJob();
    await openItem(2);
    expect(screen.getByTestId("item-title")).toHaveTextContent("Ceilings painted, two coats");
    expect(screen.getByTestId("item-position")).toHaveTextContent("Item 2 of 9");
    await act(async () => router.push(`/jobs/${J}/items/no-such-item`));
    expect(within(await screen.findByTestId("item-unavailable")).getByText(CHECKLIST_MSG.unavailable)).toBeTruthy();
  });

  it("has 56 dp choices and a labelled note field", async () => {
    await openJob();
    await openItem(1);
    expect(StyleSheet.flatten(screen.getByTestId("item-done").props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(screen.getByTestId("item-note-input").props.accessibilityLabel).toBe("Note (optional)");
  });
});

describe("sending: the engine, the header line and sign-out", () => {
  it("Sync now sends the draft with the fields that changed, the header reads 'All sent', and the sign-out count drops", async () => {
    const t = makeTestStore();
    const { server } = await openJob(t);
    expect(screen.getByTestId("sync-status-text")).toHaveTextContent("All sent");
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    await type("report-notes-input", "All done");
    await waitFor(() => expect(t.store.drafts.draft(DAN.id, J)?.notes).toBe("All done"));
    expect(t.store.unsent.summaryFor(DAN.id)).toEqual({ photos: 0, reports: 1 });
    expect(screen.getByTestId("sync-status-text")).toHaveTextContent(/Waiting to send \(1 report\)|Sending 1 report/);
    await fireEvent.press(await screen.findByTestId("sync-now"));
    await waitFor(() => expect(screen.getByTestId("sync-status-text")).toHaveTextContent("All sent"));
    const patches = server.requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ path: `/operative/jobs/${J}/report`, body: { notes: "All done", checklist: [{ item_id: item(1), status: "done", note: null }] } });
    expect(t.store.unsent.summaryFor(DAN.id)).toEqual({ photos: 0, reports: 0 });
    // The server's answer is in the cache: the screen still shows the same progress.
    expect(summary()).toHaveTextContent("1 of 9 done");
    expect(screen.getByTestId("job-status-text")).toHaveTextContent("In progress, 1 of 9 done");
  });

  it("with no signal the header says 'Waiting for signal (1 report)' and the work stays on the phone", async () => {
    const t = makeTestStore();
    const { server } = await openJob(t);
    server.offline = true;
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    await fireEvent.press(await screen.findByTestId("sync-now"));
    await waitFor(() => expect(screen.getByTestId("sync-status-text")).toHaveTextContent("Waiting for signal (1 report)"));
    expect(await t.store.unsent.summaryFor(DAN.id)).toMatchObject({ reports: 1 });
    expect(state(1)).toHaveTextContent("Done");
    server.offline = false;
    await fireEvent.press(await screen.findByTestId("sync-now"));
    await waitFor(() => expect(screen.getByTestId("sync-status-text")).toHaveTextContent("All sent"));
  });

  it("a cancelled job shows 'Needs attention (1)' and keeps everything", async () => {
    const t = makeTestStore();
    const { server } = await openJob(t);
    server.operative.saveFailWith = { status: 409, code: "job_cancelled" };
    await fireEvent.press(screen.getByTestId(`checklist-toggle-${item(1)}`));
    await fireEvent.press(await screen.findByTestId("sync-now"));
    await waitFor(() => expect(screen.getByTestId("sync-status-text")).toHaveTextContent("Needs attention (1)"));
    expect(state(1)).toHaveTextContent("Done");
    expect(await t.store.unsent.summaryFor(DAN.id)).toMatchObject({ reports: 1 });
  });
});
