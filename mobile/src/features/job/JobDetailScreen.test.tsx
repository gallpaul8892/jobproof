import { Linking, StyleSheet } from "react-native";
import { router } from "expo-router";
import { act, fireEvent, screen, waitFor, within } from "expo-router/testing-library";
import type { OperativeJob } from "@jobproof/shared";
import { cleanupLaunched } from "../../../test/harness";
import { fakeServer } from "../../../test/fakeServer";
import { EXTERIOR, LOUNGE, WALL, checklist, list, makeJob } from "../../../test/jobFixtures";
import { launchSignedIn } from "../../../test/signedIn";
import { MSG } from "./JobDetailScreen";
import { mapsUrl, notesNeedToggle, telUrl } from "./links";

afterEach(() => {
  jest.restoreAllMocks();
  cleanupLaunched();
});

async function openJob(server: ReturnType<typeof fakeServer>, id: string) {
  const launched = await launchSignedIn(server);
  await screen.findByTestId("jobs-today");
  await fireEvent.press(screen.getByTestId(`job-row-${id}`));
  await screen.findByTestId("job-screen");
  return launched;
}

const contains = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
/** React Native's jest setup already mocks Linking; clear what earlier tests recorded. */
function spyOpen() {
  const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  spy.mockClear();
  return spy;
}
const pull = async () => {
  const { refreshControl } = screen.getByTestId("job-screen").props;
  await act(async () => {
    await refreshControl.props.onRefresh();
  });
};

function serverWith(...jobs: OperativeJob[]) {
  const server = fakeServer();
  server.setJobs(list({ jobs_today: jobs }));
  return server;
}

describe("T-003d scenario 1: job detail content", () => {
  it("shows reference, type, address, notes and scheduled date", async () => {
    await openJob(serverWith(LOUNGE, WALL, EXTERIOR), "job-lounge");
    expect(screen.getByTestId("job-title")).toHaveTextContent(contains("Repaint lounge, hall and landing"));
    expect(screen.getByTestId("job-reference")).toHaveTextContent(contains("JOB-2026-0101"));
    expect(screen.getByTestId("job-type")).toHaveTextContent(contains("Interior repaint"));
    expect(screen.getByTestId("job-date")).toHaveTextContent(contains("9 Nov 2026"));
    expect(screen.getByTestId("job-address")).toHaveTextContent(contains("12 Elm Road, Bristol, BS6 5QA"));
    expect(screen.getByTestId("job-notes")).toHaveTextContent(contains("Key safe by the front door; code sent by text"));
    expect(screen.getByTestId("job-status-text")).toHaveTextContent(contains("To do"));
  });

  it("opens from the list cache without another request and never says painter", async () => {
    const server = serverWith(LOUNGE);
    await openJob(server, "job-lounge");
    expect(server.requests.filter((r) => r.path.startsWith("/operative/jobs/"))).toHaveLength(0);
    expect(screen.queryByText(/painter/i)).toBeNull();
  });

  it("the back link returns to My jobs", async () => {
    await openJob(serverWith(LOUNGE), "job-lounge");
    await fireEvent.press(screen.getByTestId("job-back"));
    expect(await screen.findByTestId("my-jobs-screen")).toBeTruthy();
  });
});

describe("T-003d scenario 2: customer contact", () => {
  it("shows the contact name and phone and opens the dialler with the number filled in", async () => {
    const open = spyOpen();
    await openJob(serverWith(LOUNGE), "job-lounge");
    expect(screen.getByTestId("job-contact-name")).toHaveTextContent(contains("Mrs A. Patel"));
    const phone = screen.getByTestId("job-contact-phone");
    expect(phone).toHaveTextContent(contains("07700 900555"));
    await fireEvent.press(phone);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("tel:07700900555");
  });

  it("shows no email or billing details", async () => {
    const withExtras = { ...LOUNGE, contact: { ...LOUNGE.contact!, email: "a.patel@example.test" } } as OperativeJob;
    await openJob(serverWith(withExtras), "job-lounge");
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.queryByText(/billing|email/i)).toBeNull();
  });

  it("a contact without a phone number says so and offers no call", async () => {
    await openJob(serverWith(makeJob({ ...LOUNGE, contact: { name: "Mrs A. Patel", phone: null } })), "job-lounge");
    expect(screen.getByTestId("job-contact-nophone")).toHaveTextContent(MSG.noPhone);
    expect(screen.queryByTestId("job-contact-phone")).toBeNull();
  });

  it("tells the operative when the phone cannot open the dialler", async () => {
    spyOpen().mockRejectedValue(new Error("No Activity found"));
    await openJob(serverWith(LOUNGE), "job-lounge");
    await fireEvent.press(screen.getByTestId("job-contact-phone"));
    expect(await screen.findByText(MSG.cantCall)).toBeTruthy();
  });

  it("builds tel: URLs from tidy digits and keeps a leading +", () => {
    expect(telUrl("07700 900555")).toBe("tel:07700900555");
    expect(telUrl("+44 (0)7700 900555")).toBe("tel:+4407700900555");
    expect(telUrl("n/a")).toBeNull();
  });
});

describe("T-003d scenario 3: address opens maps", () => {
  it("opens a geo: URL with the encoded address", async () => {
    const open = spyOpen();
    await openJob(serverWith(LOUNGE), "job-lounge");
    await fireEvent.press(screen.getByTestId("job-address"));
    expect(open).toHaveBeenCalledWith("geo:0,0?q=12%20Elm%20Road%2C%20Bristol%2C%20BS6%205QA");
    expect(open.mock.calls[0]![0]).toBe(mapsUrl(LOUNGE.site_address));
  });

  it("tells the operative when no maps app opens", async () => {
    spyOpen().mockRejectedValue(new Error("none"));
    await openJob(serverWith(LOUNGE), "job-lounge");
    await fireEvent.press(screen.getByTestId("job-address"));
    expect(await screen.findByText(MSG.cantMap)).toBeTruthy();
  });

});

describe("T-003d scenario 4: checklist shown", () => {
  it("lists all 9 items in order, none ticked, with '0 of 9 done'", async () => {
    await openJob(serverWith(LOUNGE), "job-lounge");
    expect(screen.getByTestId("checklist-summary")).toHaveTextContent(contains("0 of 9 done"));
    const rows = screen.getAllByTestId(/^checklist-item-/);
    expect(rows).toHaveLength(9);
    expect(within(rows[0]!).getByText("Walls filled and sanded")).toBeTruthy();
    expect(within(rows[1]!).getByText("Ceilings painted, two coats")).toBeTruthy();
    for (const row of rows) expect(within(row).getByText("Not done yet")).toBeTruthy();
    expect(rows[0]!.props.accessibilityLabel).toBe("Item 1 of 9. Walls filled and sanded. Not done yet.");
  });

  it("shows done and can't-do items, with the reason", async () => {
    const items = checklist(3);
    items[0] = { ...items[0]!, status: "done" };
    items[1] = { ...items[1]!, status: "not_done", note: "Wet weather" };
    await openJob(serverWith(makeJob({ ...LOUNGE, checklist: items, checklist_total: 3, checklist_dealt_with: 2, status: "in_progress" })), "job-lounge");
    expect(screen.getByTestId("checklist-summary")).toHaveTextContent(contains("2 of 3 done"));
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Can't do this: Wet weather")).toBeTruthy();
  });
});

describe("T-003d scenario 5: no checklist", () => {
  it("says so and still shows the rest of the job", async () => {
    await openJob(serverWith(makeJob({ ...WALL, checklist: [] })), "job-wall");
    expect(screen.getByTestId("checklist-empty")).toHaveTextContent(MSG.noChecklist);
    expect(screen.queryByTestId("checklist-summary")).toBeNull();
    expect(screen.getByTestId("job-address")).toBeTruthy();
    expect(screen.getByTestId("job-notes-empty")).toHaveTextContent(MSG.noNotes);
  });
});

describe("T-003d scenario 6: long notes", () => {
  it("collapses 1,500 characters to 6 lines with 'Show more', and expands", async () => {
    await openJob(serverWith(EXTERIOR), "job-exterior");
    expect(screen.getByTestId("job-notes").props.numberOfLines).toBe(6);
    const toggle = screen.getByTestId("job-notes-toggle");
    expect(toggle.props.accessibilityLabel).toBe("Show more");
    await fireEvent.press(toggle);
    expect(screen.getByTestId("job-notes").props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId("job-notes").props.children).toHaveLength(1500);
    expect(screen.getByTestId("job-notes-toggle").props.accessibilityLabel).toBe("Show less");
    await fireEvent.press(screen.getByTestId("job-notes-toggle"));
    expect(screen.getByTestId("job-notes").props.numberOfLines).toBe(6);
  });

  it("short notes have no toggle", async () => {
    await openJob(serverWith(LOUNGE), "job-lounge");
    expect(screen.queryByTestId("job-notes-toggle")).toBeNull();
    expect(screen.getByTestId("job-notes").props.numberOfLines).toBeUndefined();
  });

  it("decides on a toggle by length and by line breaks", () => {
    expect(notesNeedToggle("short")).toBe(false);
    expect(notesNeedToggle("x".repeat(201))).toBe(true);
    expect(notesNeedToggle("a\nb\nc\nd\ne\nf\ng")).toBe(true);
  });
});

describe("T-003d scenario 7: not my job", () => {
  it("says it isn't available and goes back to the list", async () => {
    const server = serverWith(LOUNGE);
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    await act(async () => {
      router.push("/jobs/priyas-job");
    });
    expect(await screen.findByText(MSG.unavailable)).toBeTruthy();
    expect(screen.queryByTestId("checklist")).toBeNull();
    await fireEvent.press(screen.getByTestId("job-unavailable-back"));
    expect(await screen.findByTestId("my-jobs-screen")).toBeTruthy();
    expect(screen.queryByText(MSG.unavailable)).toBeNull();
  });

  it("a job the office reassigned after loading becomes unavailable on refresh", async () => {
    const server = serverWith(LOUNGE);
    await openJob(server, "job-lounge");
    server.operative.jobs.clear();
    await pull();
    expect(await screen.findByText(MSG.unavailable)).toBeTruthy();
  });
});

describe("T-003d scenario 8: job changed by the office", () => {
  it("pull to refresh shows the new notes", async () => {
    const server = serverWith(LOUNGE);
    await openJob(server, "job-lounge");
    server.operative.jobs.set(LOUNGE.id, { ...LOUNGE, notes: "Gate code changed to 4321" });
    await pull();
    await waitFor(() => expect(screen.getByTestId("job-notes")).toHaveTextContent(contains("Gate code changed to 4321")));
    expect(server.requests.filter((r) => r.path === "/operative/jobs/job-lounge")).toHaveLength(1);
  });
});

describe("T-003d scenario 9: offline", () => {
  it("a job opened before still shows, with 'Offline', after a failed refresh", async () => {
    const server = serverWith(LOUNGE);
    await openJob(server, "job-lounge");
    server.offline = true;
    await pull();
    expect(await screen.findByText(MSG.offline)).toBeTruthy();
    expect(screen.getByTestId("job-title")).toHaveTextContent(contains("Repaint lounge, hall and landing"));
    expect(screen.getByTestId("checklist-summary")).toHaveTextContent(contains("0 of 9 done"));
    expect(screen.getByTestId("job-notes")).toBeTruthy();
  });

  it("every job on the list was saved by the list load, so one never opened opens offline", async () => {
    const server = serverWith(LOUNGE, WALL, EXTERIOR);
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    server.offline = true;
    await fireEvent.press(screen.getByTestId("job-row-job-exterior"));
    expect(await screen.findByTestId("job-title")).toHaveTextContent(contains("Exterior repaint, front elevation"));
    expect(screen.getByTestId("checklist-summary")).toHaveTextContent(contains("0 of 14 done"));
  });

  it("a job never seen, with no signal, says its details weren't saved", async () => {
    const server = serverWith(LOUNGE);
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    server.offline = true;
    await act(async () => {
      router.push("/jobs/never-seen");
    });
    expect(await screen.findByText(MSG.notSaved)).toBeTruthy();
    expect(screen.getByTestId("job-error-retry")).toBeTruthy();
    expect(screen.getByTestId("job-back")).toBeTruthy(); // never a dead end
  });

  it("a server error with no saved job offers Retry", async () => {
    const server = serverWith(LOUNGE);
    await launchSignedIn(server);
    await screen.findByTestId("jobs-today");
    server.operative.failWith = 500;
    await act(async () => {
      router.push("/jobs/never-seen");
    });
    expect(await screen.findByText(MSG.loadFailed)).toBeTruthy();
  });
});

describe("T-003d scenario 10: submitted job is read-only", () => {
  const submitted = makeJob({
    ...LOUNGE,
    status: "submitted",
    checklist_dealt_with: 9,
    report: {
      id: "r1",
      state: "submitted",
      notes: null,
      submitted_at: "2026-11-09T14:12:00Z",
      submitted_by: { id: "u", name: "Dan Hughes" },
      review_status: "reviewed",
      reviewed_at: "2026-11-09T15:00:00Z",
      reviewed_by: { id: "m", name: "Sarah Whitfield" },
      submission_id: null,
      device_submitted_at: null,
      photos: [],
      sign_off: null,
    },
  });

  it("shows 'Submitted 14:12' and who reviewed it, with no capture controls", async () => {
    await openJob(serverWith(submitted), "job-lounge");
    expect(screen.getByTestId("job-submitted")).toHaveTextContent(contains("Submitted 14:12"));
    expect(screen.getByTestId("job-submitted")).toHaveTextContent(contains("Reviewed by Sarah Whitfield"));
    expect(screen.getByTestId("job-status-text")).toHaveTextContent(contains("Submitted"));
    expect(screen.queryByRole("button", { name: /photo|camera|capture|submit report/i })).toBeNull();
    expect(screen.queryByTestId("capture-start")).toBeNull();
  });

  it("shows 14:12 in London time in summer too (13:12 UTC)", async () => {
    const summer = { ...submitted, report: { ...submitted.report!, submitted_at: "2026-07-09T13:12:00Z", reviewed_by: null } } as OperativeJob;
    await openJob(serverWith(summer), "job-lounge");
    expect(screen.getByTestId("job-submitted")).toHaveTextContent(contains("Submitted 14:12"));
    expect(screen.queryByText(/Reviewed by/)).toBeNull();
  });
});

describe("T-003m groundwork: accessibility", () => {
  it("reads in a sensible TalkBack order and keeps targets at 48 dp", async () => {
    await openJob(serverWith(LOUNGE), "job-lounge");
    const ids = screen.getAllByTestId(/^(job-|checklist)/).map((e) => String(e.props.testID));
    const order = ["job-back", "job-title", "job-status", "job-reference", "job-address", "job-contact-name", "job-contact-phone", "job-notes", "checklist-summary", "checklist-item-job-lounge-item-1"];
    const at = order.map((id) => ids.indexOf(id));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const id of ["job-back", "job-address", "job-contact-phone"]) {
      const style = StyleSheet.flatten(screen.getByTestId(id).props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
    }
    expect(screen.getByTestId("job-address").props.accessibilityLabel).toBe("Address: 12 Elm Road, Bristol, BS6 5QA. Opens in a maps app");
    expect(screen.getByRole("header", { name: "Repaint lounge, hall and landing" })).toBeTruthy();
  });

  it("text can scale: no fixed heights on text, scaling not disabled", async () => {
    await openJob(serverWith(EXTERIOR), "job-exterior");
    expect(screen.getByTestId("job-notes").props.allowFontScaling).not.toBe(false);
    expect(screen.getByTestId("job-title").props.allowFontScaling).not.toBe(false);
    const style = StyleSheet.flatten(screen.getByTestId("job-title").props.style) as Record<string, unknown>;
    expect(style.height).toBeUndefined();
    expect(style.lineHeight).toBeUndefined();
  });
});
