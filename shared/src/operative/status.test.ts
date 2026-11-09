import { describe, expect, it } from "vitest";
import {
  checklistItemStateLabel,
  checklistSummary,
  isFinishedJob,
  operativeJobStatusLabel,
  operativeStatusIcon,
  operativeStatusWord,
  orderJobsForDisplay,
} from "./status";
import { queryKeys } from "../api/queryKeys";
import type { OperativeJobStatus } from "../generated";

const job = (status: OperativeJobStatus, done = 0, total = 9) => ({ status, checklist_dealt_with: done, checklist_total: total });

describe("operativeJobStatusLabel", () => {
  it.each([
    [job("to_do"), "To do"],
    [job("in_progress", 6, 9), "In progress, 6 of 9 done"],
    [job("in_progress", 0, 9), "In progress, 0 of 9 done"],
    [job("in_progress", 0, 0), "In progress"],
    [job("submitted", 9, 9), "Submitted"],
    [job("completed_by_office", 0, 0), "Completed by office"],
    [job("cancelled"), "Cancelled"],
  ])("%j -> %s", (j, label) => expect(operativeJobStatusLabel(j)).toBe(label));

  it("never renders an unknown status as blank", () => {
    const odd = job("surprise" as OperativeJobStatus);
    expect(operativeStatusWord(odd)).toBe("Unknown");
    expect(operativeStatusIcon(odd)).toBe("?");
  });

  it("has a distinct icon for every status, so colour is never the only cue", () => {
    const icons = (["to_do", "in_progress", "submitted", "cancelled"] as const).map((s) => operativeStatusIcon({ status: s }));
    expect(new Set(icons).size).toBe(4);
  });
});

describe("checklistSummary", () => {
  it("reads '0 of 9 done'", () => expect(checklistSummary(job("to_do"))).toBe("0 of 9 done"));
});

describe("finished jobs", () => {
  it.each([
    ["to_do", false],
    ["in_progress", false],
    ["submitted", true],
    ["completed_by_office", true],
    ["cancelled", true],
  ] as const)("%s finished=%s", (s, finished) => expect(isFinishedJob({ status: s })).toBe(finished));

  it("moves finished jobs below open ones and keeps the order inside each group", () => {
    const list = [
      { id: "a", status: "submitted" as const },
      { id: "b", status: "to_do" as const },
      { id: "c", status: "cancelled" as const },
      { id: "d", status: "in_progress" as const },
    ];
    expect(orderJobsForDisplay(list).map((j) => j.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("checklistItemStateLabel", () => {
  it("describes each state", () => {
    expect(checklistItemStateLabel({ status: "open", note: null })).toBe("Not done yet");
    expect(checklistItemStateLabel({ status: "done", note: null })).toBe("Done");
    expect(checklistItemStateLabel({ status: "not_done", note: "Wet weather" })).toBe("Can't do this: Wet weather");
    expect(checklistItemStateLabel({ status: "not_done", note: null })).toBe("Can't do this");
  });
});

describe("query keys", () => {
  it("are the documented ones", () => {
    expect(queryKeys.operativeJobs).toEqual(["operative", "jobs"]);
    expect(queryKeys.operativeJob("x")).toEqual(["operative", "job", "x"]);
  });
});
