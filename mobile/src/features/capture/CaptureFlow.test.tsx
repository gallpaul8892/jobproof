import { Linking } from "react-native";
import { router } from "expo-router";
import { act, fireEvent, screen, waitFor, within } from "expo-router/testing-library";
import { cleanupLaunched } from "../../../test/harness";
import { fakeServer } from "../../../test/fakeServer";
import { DAN, PRIYA } from "../../../test/helpers";
import { LOUNGE, WALL, list } from "../../../test/jobFixtures";
import { launchSignedIn } from "../../../test/signedIn";
import { MB } from "../../../test/support/memoryFiles";
import { makeTestStore, type TestStore } from "../../../test/support/store";
import { SHUTTER_SIZE } from "./CameraScreen";

type Cam = {
  permission: unknown;
  onRequest: unknown;
  requested: number;
  taken: number;
  takePicture: (o?: unknown) => Promise<{ uri: string; width: number; height: number }>;
};
const cam = () => (globalThis as unknown as { __camera: Cam }).__camera;

afterEach(() => {
  jest.restoreAllMocks();
  cleanupLaunched();
});

let shots = 0;
/** Each press of the (mocked) shutter yields a new file in the camera's cache folder. */
function cameraYields(t: TestStore) {
  cam().takePicture = async () => ({ uri: t.files.seed(`file:///cache/shot-${++shots}.jpg`, `shot-${shots}`), width: 4000, height: 3000 });
}

function serverWithJobs() {
  const server = fakeServer();
  server.setJobs(list({ jobs_today: [LOUNGE, WALL] }));
  return server;
}

async function start(t = makeTestStore(), user = DAN) {
  cameraYields(t);
  await launchSignedIn(serverWithJobs(), user, t.store);
  await screen.findByTestId("jobs-today");
  return t;
}
async function openJob(id = "job-lounge") {
  await fireEvent.press(screen.getByTestId(`job-row-${id}`));
  await screen.findByTestId("photo-section");
}
async function openCamera() {
  await fireEvent.press(screen.getByTestId("take-photo"));
  await screen.findByTestId("camera-screen");
}
const shoot = async () => {
  await fireEvent.press(screen.getByTestId("shutter"));
};
const saved = (t: TestStore, job = "job-lounge", user = DAN.id) => t.store.photos.listForJob(user, job);
const seedPhotos = async (t: TestStore, n: number, job = "job-lounge", itemId?: string) => {
  for (let i = 0; i < n; i++) {
    const r = await t.store.capture.saveShot({ ownerUserId: DAN.id, jobId: job, stage: "before", itemId }, { uri: t.files.seed(`file:///cache/seed-${++shots}.jpg`), width: 1, height: 1 });
    if (!r.ok) throw new Error(r.message);
  }
  await t.store.capture.idle();
};

describe("T-003e scenario 1: take a before photo", () => {
  it("Take photo, shutter: the photo is in the Before group with its time, and the job is In progress", async () => {
    const t = await start();
    await openJob();
    expect(screen.getByTestId("job-status-text")).toHaveTextContent(/To do/);
    expect(screen.getByTestId("photo-group-empty-before")).toBeTruthy();

    await openCamera();
    expect(screen.getByTestId("camera-stage-before").props.accessibilityState).toMatchObject({ selected: true });
    await shoot();
    expect(await screen.findByTestId("camera-last")).toBeTruthy();
    expect(screen.getByTestId("camera-last-time")).toHaveTextContent("08:14");
    expect(screen.getByTestId("camera-counter")).toHaveTextContent("1 photo");

    expect(saved(t)).toHaveLength(1);
    expect(t.store.photos.reportState(DAN.id, "job-lounge")).toBe("draft"); // the draft row was created

    await fireEvent.press(screen.getByTestId("camera-done"));
    await screen.findByTestId("photo-group-before");
    expect(screen.getByTestId("photo-group-title-before")).toHaveTextContent("Before (1)");
    expect(within(screen.getByTestId("photo-group-before")).getByText("08:14")).toBeTruthy();
    expect(screen.getByTestId("job-status-text")).toHaveTextContent(/In progress/);
  });

  it("the camera is opened with the camera's own capture, never the gallery: no media library is touched", async () => {
    const t = await start();
    await openJob();
    await openCamera();
    await shoot();
    await screen.findByTestId("camera-last");
    // everything stored is app-private
    for (const key of t.files.entries.keys()) expect(key.startsWith("file:///app/photos/") || key.startsWith("file:///cache/")).toBe(true);
  });
});

describe("T-003e scenario 2: stages", () => {
  it("three large buttons, the last used stage preselected, remembered for the next shot", async () => {
    const t = makeTestStore();
    t.store.photos.setLastStage(DAN.id, "after");
    await start(t);
    await openJob();
    await openCamera();
    for (const s of ["before", "during", "after"]) {
      const b = screen.getByTestId(`camera-stage-${s}`);
      expect(b.props.accessibilityRole).toBe("radio");
    }
    expect(screen.getByTestId("camera-stage-after").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("camera-stage-before").props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId("camera-stage-during"));
    await shoot();
    await screen.findByTestId("camera-last");
    expect(saved(t)[0]!.stage).toBe("during");
    expect(t.store.photos.lastStage(DAN.id)).toBe("during");
  });

  it("the stage of a taken photo can be changed until it is submitted", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId(`photo-${saved(t)[0]!.id}`));
    await screen.findByTestId("photo-screen");
    await fireEvent.press(screen.getByTestId("photo-stage-after"));
    expect(saved(t)[0]!.stage).toBe("after");
    expect(screen.getByTestId("photo-stage-text")).toHaveTextContent("After");
  });
});

describe("T-003e scenario 3: several in a row", () => {
  it("the shutter is ready straight after each shot and the counter reaches 5", async () => {
    const t = await start();
    await openJob();
    await openCamera();
    for (let i = 1; i <= 5; i++) {
      await shoot();
      expect(screen.getByTestId("shutter").props.accessibilityState).toMatchObject({ disabled: false });
      await waitFor(() => expect(screen.getByTestId("camera-counter")).toHaveTextContent(new RegExp(`^${i} photos?$`)));
    }
    expect(screen.getByTestId("camera-counter")).toHaveTextContent("5 photos");
    expect(cam().taken).toBe(5);
    expect(new Set(saved(t).map((p) => p.id)).size).toBe(5);
  });

  it("while the camera itself is taking a picture a second press is ignored (no duplicate)", async () => {
    const t = await start();
    let release!: () => void;
    cam().takePicture = () => new Promise((r) => (release = () => r({ uri: t.files.seed("file:///cache/slow.jpg"), width: 1, height: 1 })));
    await openJob();
    await openCamera();
    await shoot();
    await shoot();
    expect(cam().taken).toBe(1);
    await act(async () => release());
    await waitFor(() => expect(saved(t)).toHaveLength(1));
  });

  it("the shutter is at least 72 dp and labelled", async () => {
    await start();
    await openJob();
    await openCamera();
    expect(SHUTTER_SIZE).toBeGreaterThanOrEqual(72);
    expect(screen.getByLabelText("Take photo", { exact: true })).toBeTruthy();
  });
});

describe("T-003e scenario 14: switching jobs mid-capture", () => {
  it("a shot still being taken for job A lands on A even after the operative opens job B", async () => {
    const t = await start();
    let release!: () => void;
    cam().takePicture = () => new Promise((r) => (release = () => r({ uri: t.files.seed("file:///cache/late.jpg"), width: 1, height: 1 })));
    await openJob("job-lounge");
    await openCamera();
    await shoot();
    await act(async () => router.replace("/jobs/job-wall"));
    await act(async () => release());
    await waitFor(() => expect(saved(t, "job-lounge")).toHaveLength(1));
    expect(saved(t, "job-wall")).toHaveLength(0);
  });
});

describe("T-003e scenario 5, 6 and 12: gallery", () => {
  const asset = (t: TestStore, name: string, over = {}) => ({ uri: t.files.seed(`file:///picker/${name}.jpg`, name), width: 1, height: 1, type: "image", mimeType: "image/jpeg", exif: { DateTimeOriginal: "2026:11:08 17:05:09" }, ...over });

  it("pick, choose During: added 'From gallery' with the original time", async () => {
    const t = await start();
    t.picker.next = [asset(t, "old")];
    await openJob();
    await fireEvent.press(screen.getByTestId("gallery-import"));
    const dialog = await screen.findByTestId("gallery-stage-dialog");
    expect(within(dialog).getByTestId("gallery-stage-message")).toHaveTextContent("Add 1 photo as Before.");
    await fireEvent.press(screen.getByTestId("gallery-stage-during"));
    await fireEvent.press(screen.getByTestId("gallery-stage-add"));
    expect(await screen.findByTestId("gallery-import-result")).toHaveTextContent("1 photo added.");
    const [p] = saved(t);
    expect(p).toMatchObject({ source: "gallery", stage: "during" });
    expect(screen.getByTestId(`photo-gallery-${p!.id}`)).toHaveTextContent("From gallery");
    expect(screen.getByTestId(`photo-time-${p!.id}`)).toHaveTextContent("17:05");
  });

  it("four at once, one stage, summary '4 photos added'; the picker may offer up to the room left", async () => {
    const t = await start();
    t.picker.next = ["a", "b", "c", "d"].map((n) => asset(t, n));
    await openJob();
    await fireEvent.press(screen.getByTestId("gallery-import"));
    await screen.findByTestId("gallery-stage-dialog");
    await fireEvent.press(screen.getByTestId("gallery-stage-add"));
    expect(await screen.findByText("4 photos added.")).toBeTruthy();
    expect(saved(t)).toHaveLength(4);
    expect(t.picker.calls[0]).toEqual({ selectionLimit: 60 });
    expect(screen.getByTestId("photo-group-title-before")).toHaveTextContent("Before (4)");
  });

  it("a video or missing file is skipped with '1 file couldn't be added' and the rest go in", async () => {
    const t = await start();
    t.picker.next = [asset(t, "ok"), asset(t, "clip", { type: "video", mimeType: "video/mp4" })];
    await openJob();
    await fireEvent.press(screen.getByTestId("gallery-import"));
    await screen.findByTestId("gallery-stage-dialog");
    await fireEvent.press(screen.getByTestId("gallery-stage-add"));
    expect(await screen.findByText("1 photo added. 1 file couldn't be added.")).toBeTruthy();
    expect(saved(t)).toHaveLength(1);
  });

  it("closing the picker or the stage dialog adds nothing", async () => {
    const t = await start();
    await openJob();
    t.picker.next = null;
    await fireEvent.press(screen.getByTestId("gallery-import"));
    expect(screen.queryByTestId("gallery-stage-dialog")).toBeNull();
    t.picker.next = [asset(t, "x")];
    await fireEvent.press(screen.getByTestId("gallery-import"));
    await screen.findByTestId("gallery-stage-dialog");
    await fireEvent.press(screen.getByTestId("gallery-stage-cancel"));
    expect(saved(t)).toHaveLength(0);
  });
});

describe("T-003e scenario 7: caption", () => {
  it("saves 'Damp patch above window', shows it under the thumbnail", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    await start(t);
    await openJob();
    const id = saved(t)[0]!.id;
    await fireEvent.press(screen.getByTestId(`photo-${id}`));
    await screen.findByTestId("photo-screen");
    expect(screen.getByTestId("photo-caption-save").props.accessibilityState).toMatchObject({ disabled: true }); // never required
    await fireEvent.changeText(screen.getByTestId("photo-caption-input"), "Damp patch above window");
    await fireEvent.press(screen.getByTestId("photo-caption-save"));
    expect(saved(t)[0]!.caption).toBe("Damp patch above window");
    await fireEvent.press(screen.getByTestId("photo-back"));
    expect(await screen.findByTestId(`photo-caption-${id}`)).toHaveTextContent("Damp patch above window");
  });

  it("a caption over 140 characters is refused with the message and the text is kept", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId(`photo-${saved(t)[0]!.id}`));
    await screen.findByTestId("photo-screen");
    const long = "a".repeat(141);
    await fireEvent.changeText(screen.getByTestId("photo-caption-input"), long);
    await fireEvent.press(screen.getByTestId("photo-caption-save"));
    expect(screen.getByTestId("photo-caption-input-error")).toHaveTextContent("Keep it to 140 characters.");
    expect(screen.getByTestId("photo-caption-input").props.value).toBe(long);
    expect(saved(t)[0]!.caption).toBeNull();
  });
});

describe("T-003e scenario 8: view a photo", () => {
  it("full screen with stage, time, zoom; and no crop, rotate, filter or draw tool anywhere", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId(`photo-${saved(t)[0]!.id}`));
    await screen.findByTestId("photo-screen");
    expect(screen.getByTestId("photo-stage-text")).toHaveTextContent("Before");
    expect(screen.getByTestId("photo-time")).toHaveTextContent("08:14");
    expect(screen.getByTestId("photo-image").props.accessibilityLabel).toMatch(/Before photo taken 08:14/);
    expect(screen.getByTestId("photo-zoom-in")).toBeTruthy();
    for (const word of [/crop/i, /rotate/i, /filter/i, /draw/i, /annotate/i, /edit photo/i]) {
      expect(screen.queryByLabelText(word)).toBeNull();
      expect(screen.queryByText(word)).toBeNull();
      expect(screen.queryByRole("button", { name: word })).toBeNull();
    }
  });

  it("a photo that is not this operative's, or not this job's, is 'not available'", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    const id = saved(t)[0]!.id;
    await start(t, PRIYA);
    await openJob();
    await act(async () => router.push(`/jobs/job-lounge/photos/${id}`));
    expect(await screen.findByTestId("photo-unavailable")).toHaveTextContent(/^This photo isn't available\./);
  });

  it("zoom buttons change and reset the picture", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId(`photo-${saved(t)[0]!.id}`));
    await screen.findByTestId("photo-screen");
    expect(screen.getByTestId("photo-zoom-out").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId("photo-zoom-in"));
    const style = (screen.getByTestId("photo-image").props.style as { transform: { scale?: number }[] }[]);
    const flat = Object.assign({}, ...style.flat());
    expect(flat.transform.find((x: { scale?: number }) => x.scale !== undefined)!.scale).toBe(1.5);
    expect(screen.getByTestId("photo-zoom-out").props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe("T-003e scenario 9: delete", () => {
  it("asks 'Delete this photo? This can't be undone.', then removes it and the counter drops", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 2);
    await start(t);
    await openJob();
    expect(screen.getByTestId("photo-count")).toHaveTextContent("2 photos");
    await fireEvent.press(screen.getByTestId(`photo-${saved(t)[0]!.id}`));
    await screen.findByTestId("photo-screen");
    await fireEvent.press(screen.getByTestId("photo-delete"));
    expect(within(screen.getByTestId("photo-delete-confirm")).getByText("Delete this photo? This can't be undone.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("photo-delete-yes"));
    await screen.findByTestId("photo-section");
    expect(screen.getByTestId("photo-count")).toHaveTextContent("1 photo");
    expect(saved(t)).toHaveLength(1);
    expect([...t.files.entries.keys()].filter((k) => k.includes("/photos/dan") || k.includes("/photos/11111111")).length).toBeGreaterThan(0); // the other photo's files stay
  });

  it("'Keep photo' is the default and deletes nothing", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId(`photo-${saved(t)[0]!.id}`));
    await screen.findByTestId("photo-screen");
    await fireEvent.press(screen.getByTestId("photo-delete"));
    await fireEvent.press(screen.getByTestId("photo-delete-cancel"));
    expect(saved(t)).toHaveLength(1);
    expect(screen.getByTestId("photo-screen")).toBeTruthy();
  });

  it("a submitted report offers no stage, caption or delete controls", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    t.db.run("UPDATE drafts SET local_state = 'submitted'");
    await start(t);
    await openJob();
    expect(screen.queryByTestId("take-photo")).toBeNull();
    expect(screen.getByTestId("photos-locked")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`photo-${saved(t)[0]!.id}`));
    await screen.findByTestId("photo-screen");
    expect(screen.queryByTestId("photo-delete")).toBeNull();
    expect(screen.queryByTestId("photo-caption-input")).toBeNull();
    expect(screen.getByTestId("photo-locked")).toBeTruthy();
  });
});

describe("T-003e scenario 10: limits", () => {
  it("at 60 photos Take photo says so and does not open the camera", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 60);
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId("take-photo"));
    expect(await screen.findByTestId("photo-refusal-text")).toHaveTextContent("This report has the maximum 60 photos.");
    expect(screen.queryByTestId("camera-screen")).toBeNull();
    expect(saved(t)).toHaveLength(60);
  });

  it("in the camera the 61st shutter press is refused and nothing is added", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 59);
    await start(t);
    await openJob();
    await openCamera();
    await shoot();
    await waitFor(() => expect(saved(t)).toHaveLength(60));
    await shoot();
    expect(await screen.findByTestId("camera-message")).toHaveTextContent("This report has the maximum 60 photos.");
    expect(saved(t)).toHaveLength(60);
    expect(cam().taken).toBe(1);
  });

  it("at 12 photos on one checklist item: 'This item has the maximum 12 photos.'", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 12, "job-lounge", "job-lounge-item-1");
    await start(t);
    await openJob();
    await act(async () => router.push("/jobs/job-lounge/camera?itemId=job-lounge-item-1"));
    await screen.findByTestId("camera-screen");
    await shoot();
    expect(await screen.findByTestId("camera-message")).toHaveTextContent("This item has the maximum 12 photos.");
    expect(saved(t)).toHaveLength(12);
  });

  it("gallery at the limit adds nothing and says why", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 60);
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId("gallery-import"));
    expect(await screen.findByTestId("gallery-import-result-text")).toHaveTextContent("This report has the maximum 60 photos.");
    expect(t.picker.calls).toHaveLength(0);
  });
});

describe("T-003e scenario 11: storage low", () => {
  it("under 500 MB a banner says so and capture still works", async () => {
    const t = makeTestStore();
    t.files.free = 400 * MB;
    await start(t);
    await openJob();
    expect(screen.getByTestId("storage-banner-text")).toHaveTextContent("Phone storage is low.");
    await openCamera();
    expect(screen.getByTestId("storage-banner")).toHaveTextContent("Phone storage is low.");
    await shoot();
    await waitFor(() => expect(saved(t)).toHaveLength(1));
  });

  it("under 100 MB capture is refused with the message", async () => {
    const t = makeTestStore();
    t.files.free = 90 * MB;
    await start(t);
    await openJob();
    await fireEvent.press(screen.getByTestId("take-photo"));
    expect(await screen.findByTestId("photo-refusal-text")).toHaveTextContent("Not enough space to save photos. Free up space on your phone.");
    expect(saved(t)).toHaveLength(0);
  });

  it("no banner when there is plenty of room", async () => {
    await start();
    await openJob();
    expect(screen.queryByTestId("storage-banner")).toBeNull();
  });

  it("space running out mid-session: the shot is refused in the camera", async () => {
    const t = await start();
    await openJob();
    await openCamera();
    t.files.free = 50 * MB;
    await shoot();
    expect(await screen.findByTestId("camera-message")).toHaveTextContent("Not enough space to save photos. Free up space on your phone.");
    expect(cam().taken).toBe(0);
  });
});

describe("camera permission (rationale and denied states)", () => {
  it("before the system prompt: explains why, and Allow camera asks; granting opens the camera", async () => {
    await start();
    cam().permission = { granted: false, status: "undetermined", canAskAgain: true };
    await openJob();
    await fireEvent.press(screen.getByTestId("take-photo"));
    expect(await screen.findByTestId("camera-rationale")).toBeTruthy();
    expect(screen.getByTestId("camera-permission-text")).toHaveTextContent(/needs the camera to take photos of the work/);
    await fireEvent.press(screen.getByTestId("camera-allow"));
    expect(cam().requested).toBe(1);
    expect(await screen.findByTestId("camera-screen")).toBeTruthy();
  });

  it("denied with no way to ask again: says so, opens Settings, and still offers the gallery", async () => {
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await start();
    cam().permission = { granted: false, status: "denied", canAskAgain: false };
    await openJob();
    await fireEvent.press(screen.getByTestId("take-photo"));
    expect(await screen.findByTestId("camera-denied")).toBeTruthy();
    expect(screen.getByTestId("camera-permission-text")).toHaveTextContent(/camera is turned off/i);
    expect(screen.queryByTestId("camera-allow")).toBeNull();
    expect(screen.getByTestId("camera-gallery-fallback")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("camera-open-settings"));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("refusing the system prompt moves to the denied state, never a blank screen", async () => {
    await start();
    cam().permission = { granted: false, status: "undetermined", canAskAgain: true };
    cam().onRequest = { granted: false, status: "denied", canAskAgain: false };
    await openJob();
    await fireEvent.press(screen.getByTestId("take-photo"));
    await fireEvent.press(await screen.findByTestId("camera-allow"));
    expect(await screen.findByTestId("camera-denied")).toBeTruthy();
    expect(screen.getByTestId("camera-open-settings")).toBeTruthy();
  });

  it("while the permission is still being read a progress message shows", async () => {
    await start();
    cam().permission = null;
    await openJob();
    await fireEvent.press(screen.getByTestId("take-photo"));
    expect(await screen.findByTestId("camera-loading")).toBeTruthy();
  });
});

describe("accessibility and wording", () => {
  it("thumbnails read as one labelled button; groups are headings; the word 'painter' never appears", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    await start(t);
    await openJob();
    const thumb = screen.getByTestId(`photo-${saved(t)[0]!.id}`);
    expect(thumb.props.accessibilityRole).toBe("button");
    expect(thumb.props.accessibilityLabel).toBe("Before photo, taken 08:14");
    expect(screen.getByTestId("photo-group-title-during").props.accessibilityRole).toBe("header");
    expect(screen.getByTestId("take-photo").props.accessibilityLabel).toBe("Take photo");
    expect(screen.queryByText(/painter/i)).toBeNull();
    expect(screen.getByTestId("photo-group-empty-after")).toHaveTextContent("No after photos yet.");
  });

  it("photos belong to the signed-in operative: a second operative on the phone sees none", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 3);
    await start(t, PRIYA);
    await openJob();
    expect(screen.getByTestId("photo-count")).toHaveTextContent("0 photos");
    expect(screen.queryAllByTestId(/^photo-[0-9a-f]{8}-/)).toHaveLength(0);
  });
});

describe("sign-out shows the true unsent count (T-003b scenario 9, real database)", () => {
  async function pressSignOut() {
    await fireEvent.press(screen.getByTestId("open-settings"));
    await fireEvent.press(await screen.findByTestId("sign-out"));
  }

  it("with 2 unsent photos the dialog names them and 'Sign out anyway' keeps every photo and file", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 2);
    t.db.run("UPDATE photos SET sync_state = 'sent' WHERE id = ?", [saved(t)[0]!.id]);
    await start(t);
    await pressSignOut();
    const dialog = await screen.findByTestId("sign-out-unsent");
    expect(within(dialog).getByTestId("sign-out-unsent-message")).toHaveTextContent("1 photo hasn't reached the office yet. Stay signed in so it can send.");
    await fireEvent.press(screen.getByTestId("sign-out-anyway"));
    await screen.findByTestId("sign-in-screen");
    expect(saved(t)).toHaveLength(2);
    expect([...t.files.entries.keys()].filter((k) => k.includes("/photos/") && !k.includes("thumbs"))).toHaveLength(2);
  });

  it("with everything sent it is the plain confirmation", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 1);
    t.db.run("UPDATE photos SET sync_state = 'sent'");
    await start(t);
    await pressSignOut();
    expect(await screen.findByTestId("sign-out-confirm")).toBeTruthy();
    expect(screen.queryByTestId("sign-out-unsent")).toBeNull();
  });

  it("another operative's unsent photos never count", async () => {
    const t = makeTestStore();
    await seedPhotos(t, 2);
    await start(t, PRIYA);
    await pressSignOut();
    expect(await screen.findByTestId("sign-out-confirm")).toBeTruthy();
  });
});
