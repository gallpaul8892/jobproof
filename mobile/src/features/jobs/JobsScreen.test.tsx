import { StyleSheet } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "expo-router/testing-library";
import { cleanupLaunched, launch } from "../../../test/harness";
import { fakeServer } from "../../../test/fakeServer";
import { DAN, PRIYA } from "../../../test/helpers";
import { EXTERIOR, LOUNGE, WALL, checklist, list, makeJob } from "../../../test/jobFixtures";
import { kv, launchSignedIn, persistedKey } from "../../../test/signedIn";
import { MUTED_TEXT } from "../../ui/colours";
import { clock } from "./clock";
import { MSG } from "./JobsScreen";

/** The fixture list is for 2026-11-09, so unless a test says otherwise the phone's clock is that morning. */
const SAME_DAY = new Date("2026-11-09T09:00:00Z");
const NEXT_DAY = new Date("2026-11-10T07:30:00Z");
beforeEach(() => void jest.spyOn(clock, "now").mockReturnValue(SAME_DAY));
afterEach(() => {
  jest.restoreAllMocks();
  cleanupLaunched();
});

const rowIds = () => screen.getAllByTestId(/^job-row-/).map((r) => r.props.testID as string);
/** The app process ends: the screen unmounts first (so the store is saved), then the in-memory client goes. */
const closeApp = async () => {
  await act(async () => {
    screen.unmount();
  });
  cleanupLaunched();
};
const pull = async () => {
  const { refreshControl } = screen.getByTestId("my-jobs-screen").props;
  await act(async () => {
    await refreshControl.props.onRefresh();
  });
};

describe("T-003c scenario 1: today's jobs", () => {
  it("lists the three jobs in order with title, town, postcode, type and 'To do'", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    expect(await screen.findByTestId("jobs-today")).toBeTruthy();
    expect(rowIds()).toEqual(["job-row-job-lounge", "job-row-job-wall", "job-row-job-exterior"]);
    const first = within(screen.getByTestId("job-row-job-lounge"));
    expect(first.getByText("Repaint lounge, hall and landing")).toBeTruthy();
    expect(first.getByText("Bristol, BS6 5QA")).toBeTruthy();
    expect(first.getByText("Interior repaint")).toBeTruthy();
    expect(first.getByText("To do")).toBeTruthy();
    expect(within(screen.getByTestId("job-row-job-wall")).getByText("Bristol, BS8 2PX")).toBeTruthy();
    expect(within(screen.getByTestId("job-row-job-exterior")).getByText("Bristol, BS3 1AB")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.queryByText("Earlier, not finished")).toBeNull();
  });

  it("each row is one labelled button for TalkBack, at least 48 dp tall", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    const row = await screen.findByTestId("job-row-job-lounge");
    expect(row.props.accessibilityLabel).toBe("Repaint lounge, hall and landing. Bristol, BS6 5QA. Interior repaint. To do");
    expect(row.props.accessible).not.toBe(false);
    expect(StyleSheet.flatten(typeof row.props.style === "function" ? row.props.style({ pressed: false }) : row.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(screen.getByRole("button", { name: /Repaint lounge/ })).toBeTruthy();
  });

  it("asks the server for the list exactly once when the app opens", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(server.requests.filter((r) => r.path === "/operative/jobs")).toHaveLength(1);
  });

  it("tapping a row opens that job", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await fireEvent.press(await screen.findByTestId("job-row-job-wall"));
    expect(await screen.findByTestId("job-title")).toHaveTextContent("Paper bedroom feature wall");
  });
});

describe("T-003c scenario 2: only my jobs", () => {
  it("shows only what the server returned for the signed-in operative, and writes each job's detail to the cache", async () => {
    const server = fakeServer();
    server.setJobs(list());
    const { client } = await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    expect(screen.queryByText(/Priya/)).toBeNull();
    for (const j of [LOUNGE, WALL, EXTERIOR]) expect(client.getQueryData(["operative", "job", j.id])).toMatchObject({ id: j.id });
    expect(server.requests.filter((r) => r.path.startsWith("/operative/jobs/"))).toHaveLength(0); // no per-job calls needed
  });
});

describe("T-003c scenario 3: earlier unfinished jobs", () => {
  it("shows them in their own section below today's jobs", async () => {
    const server = fakeServer();
    const draft = makeJob({ id: "job-old", title: "Gloss staircase", status: "in_progress", checklist: checklist(9, "job-old"), checklist_dealt_with: 6, scheduled_start: "2026-11-08" });
    server.setJobs(list({ earlier_unfinished: [draft] }));
    await launchSignedIn(server);
    const earlier = await screen.findByTestId("jobs-earlier");
    expect(within(earlier).getByText("Gloss staircase")).toBeTruthy();
    expect(screen.getByText("Earlier, not finished")).toBeTruthy();
    const all = rowIds();
    expect(all.indexOf("job-row-job-old")).toBeGreaterThan(all.indexOf("job-row-job-exterior"));
  });
});

describe("T-003c scenario 4: job states", () => {
  it("shows 'In progress, 6 of 9 done', and a submitted job last, greyed but readable", async () => {
    const server = fakeServer();
    const submitted = makeJob({ id: "job-done", title: "Hall ceiling", status: "submitted", checklist: checklist(2, "job-done"), checklist_dealt_with: 2 });
    const progress = makeJob({ ...LOUNGE, status: "in_progress", checklist_dealt_with: 6 });
    // The server may send the submitted job first; the list still puts it last.
    server.setJobs(list({ jobs_today: [submitted, progress, WALL] }));
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    expect(rowIds()).toEqual(["job-row-job-lounge", "job-row-job-wall", "job-row-job-done"]);
    expect(screen.getByTestId("job-status-job-lounge-text")).toHaveTextContent("In progress, 6 of 9 done");
    expect(screen.getByTestId("job-status-job-done-text")).toHaveTextContent("Submitted");
    const title = StyleSheet.flatten(screen.getByTestId("job-title-job-done").props.style);
    expect(title.color).toBe(MUTED_TEXT);
    const open = StyleSheet.flatten(screen.getByTestId("job-title-job-wall").props.style);
    expect(open.color).not.toBe(MUTED_TEXT);
  });

  it("labels cancelled and completed-by-office jobs", async () => {
    const server = fakeServer();
    server.setJobs(
      list({
        jobs_today: [
          makeJob({ id: "c", title: "Cancelled one", status: "cancelled" }),
          makeJob({ id: "o", title: "Office one", status: "completed_by_office" }),
        ],
      }),
    );
    await launchSignedIn(server);
    expect(await screen.findByTestId("job-status-c-text")).toHaveTextContent("Cancelled");
    expect(screen.getByTestId("job-status-o-text")).toHaveTextContent("Completed by office");
  });

  it("muted text keeps 4.5:1 against white", () => {
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const rgb = MUTED_TEXT.match(/\d+/g)!.map(Number);
    expect(1.05 / (lum(rgb) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("T-003c scenario 5: empty state", () => {
  it("says there are no jobs and shows no error", async () => {
    const server = fakeServer();
    await launchSignedIn(server);
    expect(await screen.findByText(MSG.empty)).toBeTruthy();
    expect(screen.queryByTestId("jobs-error")).toBeNull();
    expect(screen.queryByTestId("jobs-offline")).toBeNull();
  });

  it("with only earlier jobs, today says there are none", async () => {
    const server = fakeServer();
    server.setJobs(list({ jobs_today: [], earlier_unfinished: [makeJob({ id: "old", title: "Old job" })] }));
    await launchSignedIn(server);
    expect(await screen.findByTestId("jobs-none-today")).toBeTruthy();
    expect(screen.getByTestId("jobs-earlier")).toBeTruthy();
  });
});

describe("T-003c scenario 6: pull to refresh and freshness", () => {
  it("reloads, shows 'Updated 07:42' from the server time in London time, and a newly assigned job appears", async () => {
    const server = fakeServer();
    server.setJobs(list({ jobs_today: [LOUNGE] }));
    await launchSignedIn(server);
    expect(await screen.findByText("Updated 07:42")).toBeTruthy();
    expect(rowIds()).toHaveLength(1);
    const before = server.requests.filter((r) => r.path === "/operative/jobs").length;

    server.setJobs(list({ as_of: "2026-11-09T07:55:00Z", jobs_today: [LOUNGE, WALL] }));
    await pull();
    await waitFor(() => expect(rowIds()).toHaveLength(2));
    expect(server.requests.filter((r) => r.path === "/operative/jobs").length).toBe(before + 1);
    expect(screen.getByText("Updated 07:55")).toBeTruthy();
  });

  it("shows summer time as London time (08:42 for 07:42 UTC in July)", async () => {
    const server = fakeServer();
    server.setJobs(list({ as_of: "2026-07-09T07:42:00Z" }));
    await launchSignedIn(server);
    expect(await screen.findByText("Updated 08:42")).toBeTruthy();
  });

  it("has a Refresh button as well, for screen reader users who cannot pull", async () => {
    const server = fakeServer();
    server.setJobs(list({ jobs_today: [LOUNGE] }));
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    server.setJobs(list({ jobs_today: [LOUNGE, WALL] }));
    await fireEvent.press(screen.getByTestId("jobs-refresh"));
    await waitFor(() => expect(rowIds()).toHaveLength(2));
  });
});

describe("T-003c scenario 7: cancelled or reassigned", () => {
  it("a cancelled job shows 'Cancelled' and a reassigned job disappears after refresh", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    server.setJobs(list({ jobs_today: [makeJob({ ...LOUNGE, status: "cancelled" }), WALL] }));
    await pull();
    await waitFor(() => expect(screen.getByTestId("job-status-job-lounge-text")).toHaveTextContent("Cancelled"));
    expect(screen.queryByTestId("job-row-job-exterior")).toBeNull();
    expect(rowIds()).toEqual(["job-row-job-wall", "job-row-job-lounge"]); // cancelled sits with the finished jobs
  });
});

describe("T-003c scenario 8: slow and failed load", () => {
  it("shows placeholders, not a blank screen, while the first load is slow", async () => {
    const server = fakeServer();
    server.setJobs(list());
    let release!: () => void;
    server.operative.hold = new Promise<void>((r) => (release = r));
    await launchSignedIn(server);
    expect(await screen.findByTestId("jobs-skeleton")).toBeTruthy();
    expect(screen.getByLabelText("Loading jobs")).toBeTruthy();
    expect(screen.getByText("My jobs")).toBeTruthy();
    release();
    expect(await screen.findByTestId("jobs-today")).toBeTruthy();
    expect(screen.queryByTestId("jobs-skeleton")).toBeNull();
  });

  it("a failed first load says so, offers Retry, and Retry loads the list", async () => {
    const server = fakeServer();
    server.setJobs(list());
    server.operative.failWith = 503;
    await launchSignedIn(server);
    expect(await screen.findByText(MSG.loadFailed)).toBeTruthy();
    expect(screen.queryByTestId("jobs-skeleton")).toBeNull();
    server.operative.failWith = undefined;
    await fireEvent.press(screen.getByTestId("jobs-error-retry"));
    expect(await screen.findByTestId("jobs-today")).toBeTruthy();
    expect(screen.queryByText(MSG.loadFailed)).toBeNull();
  });

  it("a failed refresh keeps the last list on screen under the error", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    server.operative.failWith = 500;
    await pull();
    expect(await screen.findByText(MSG.loadFailed)).toBeTruthy();
    expect(rowIds()).toHaveLength(3);
    expect(screen.getByTestId("jobs-error-retry")).toBeTruthy();
  });
});

describe("T-003c scenario 9: offline list", () => {
  it("opens with the saved list and 'Offline. Showing jobs from 07:42.' when it is still the same day", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });

    await closeApp();
    server.offline = true;
    await launch(server);
    expect(await screen.findByText(MSG.offline("07:42"))).toBeTruthy();
    expect(rowIds()).toEqual(["job-row-job-lounge", "job-row-job-wall", "job-row-job-exterior"]);
    expect(within(screen.getByTestId("jobs-today")).getByText("Today")).toBeTruthy();
    expect(screen.queryByText(MSG.loadFailed)).toBeNull();
  });

  it("the next morning offline: yesterday's list is dated, never shown under 'Today'", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });

    await closeApp();
    jest.spyOn(clock, "now").mockReturnValue(NEXT_DAY); // a day on, at the depot with no signal
    server.offline = true;
    await launch(server);
    expect(await screen.findByText("Offline. Showing jobs from Mon 9 Nov, 07:42.")).toBeTruthy();
    expect(within(screen.getByTestId("jobs-today")).getByText("Jobs for Mon 9 Nov")).toBeTruthy();
    expect(screen.queryByText("Today")).toBeNull();
    expect(rowIds()).toHaveLength(3);
  });

  it("stores only the operative's own job data, under that user's key", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });
    const saved = JSON.parse(kv().get(persistedKey(DAN))!) as { clientState: { queries: { queryKey: unknown[] }[] } };
    const roots = new Set(saved.clientState.queries.map((q) => q.queryKey[0]));
    expect([...roots]).toEqual(["operative"]);
    expect(saved.clientState.queries.length).toBe(4); // the list and three details
  });

  it("another operative on the same phone never sees the first operative's saved list", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });
    await closeApp();
    server.offline = true;
    await launchSignedIn(server, PRIYA);
    expect(await screen.findByText(MSG.loadFailed)).toBeTruthy();
    expect(screen.queryByTestId("job-row-job-lounge")).toBeNull();
  });

  it("sign-out removes the stored list", async () => {
    const server = fakeServer();
    server.setJobs(list());
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    await waitFor(() => expect(kv().has(persistedKey(DAN))).toBe(true), { timeout: 4000 });
    await fireEvent.press(screen.getByTestId("open-settings"));
    await fireEvent.press(await screen.findByTestId("sign-out"));
    await fireEvent.press(await screen.findByTestId("sign-out-confirm-yes"));
    await screen.findByTestId("sign-in-screen");
    expect(kv().has(persistedKey(DAN))).toBe(false);
  });

  it("a corrupt stored list is ignored and removed (offline launch: no list, load-failed notice, no crash)", async () => {
    const server = fakeServer();
    server.setJobs(list());
    server.offline = true;
    kv().set(persistedKey(DAN), "{not json");
    await launchSignedIn(server);
    expect(await screen.findByText(MSG.loadFailed)).toBeTruthy();
    expect(screen.queryByTestId("jobs-today")).toBeNull();
    expect(screen.queryAllByTestId(/^job-row-/)).toHaveLength(0);
    // The bad entry is gone or replaced by a valid (job-free) snapshot; never kept as it was.
    const after = kv().get(persistedKey(DAN));
    expect(after).not.toBe("{not json");
    if (after !== undefined) expect(() => JSON.parse(after)).not.toThrow();
  });
});

describe("T-003c scenario 10: long titles and many jobs", () => {
  it("wraps a 120-character title to at most 3 lines and renders 14 rows", async () => {
    const server = fakeServer();
    const long = "Repaint ".padEnd(120, "very long job title ");
    const jobs = Array.from({ length: 14 }, (_, i) => makeJob({ id: `j${i}`, title: i === 0 ? long : `Job ${i}` }));
    server.setJobs(list({ jobs_today: jobs }));
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    expect(rowIds()).toHaveLength(14);
    const title = screen.getByTestId("job-title-j0");
    expect(title.props.numberOfLines).toBe(3);
    expect(title.props.allowFontScaling).not.toBe(false);
  });
});
