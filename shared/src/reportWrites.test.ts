import { describe, expect, it } from "vitest";
import { ApiError } from "./api/errors";
import { parseConflict } from "./conflict";
import { describeEvent, truncate } from "./history";
import { formatTime, waitingLabel } from "./format/dates";
import {
  buildReportUpdate,
  currentMatchesUpdate,
  formFromReport,
  hasProblems,
  textLength,
  validateForm,
  type FormValues,
} from "./reportEdit";
import type { AuditEvent, ReportDetail } from "./generated";
import { parseReportFilters, serialiseFilters } from "./filters";

const sarah = { id: "u1", name: "Sarah Whitfield" };
const priya = { id: "u2", name: "Priya Nair" };

describe("waitingLabel", () => {
  it("counts whole London calendar days from the server clock", () => {
    const asOf = "2026-10-15T10:42:00Z";
    expect(waitingLabel("2026-10-15T07:00:00Z", asOf)).toBe("Waiting since today");
    expect(waitingLabel("2026-10-14T23:30:00Z", asOf)).toBe("Waiting since today"); // 00:30 BST on the 15th
    expect(waitingLabel("2026-10-14T20:00:00Z", asOf)).toBe("Waiting 1 day");
    expect(waitingLabel("2026-10-05T09:00:00Z", asOf)).toBe("Waiting 10 days");
  });

  it("is right across the clocks going back (25 and 26 Oct 2026)", () => {
    const asOf = "2026-10-26T00:10:00Z"; // 00:10 GMT on the 26th
    expect(waitingLabel("2026-10-24T23:30:00Z", asOf)).toBe("Waiting 1 day"); // 00:30 BST on the 25th
    expect(waitingLabel("2026-10-24T22:30:00Z", asOf)).toBe("Waiting 2 days"); // 23:30 BST on the 24th
    expect(waitingLabel("2026-10-25T23:30:00Z", asOf)).toBe("Waiting 1 day"); // 23:30 GMT on the 25th
    expect(waitingLabel("2026-10-26T00:05:00Z", asOf)).toBe("Waiting since today");
  });

  it("never goes negative and tolerates bad input", () => {
    expect(waitingLabel("2026-10-16T09:00:00Z", "2026-10-15T09:00:00Z")).toBe("Waiting since today");
    expect(waitingLabel("nonsense", "2026-10-15T09:00:00Z")).toBe("");
  });
});

describe("sort in the report filters", () => {
  it("parses only submitted_asc and serialises it back", () => {
    expect(parseReportFilters(new URLSearchParams("sort=submitted_asc")).sort).toBe("submitted_asc");
    expect(parseReportFilters(new URLSearchParams("sort=default")).sort).toBeUndefined();
    expect(parseReportFilters(new URLSearchParams("sort=newest")).sort).toBeUndefined();
    const f = parseReportFilters(new URLSearchParams("review_status=awaiting_review&sort=submitted_asc"));
    expect(serialiseFilters(f).toString()).toBe("sort=submitted_asc&review_status=awaiting_review");
    expect(serialiseFilters({ page: 1 }).toString()).toBe("");
  });
});

describe("parseConflict", () => {
  const err = (code: string, extra: Record<string, unknown>, status = 409) =>
    new ApiError({ status, code, title: "Conflict", problem: { code, ...extra } });

  it("classes already_reviewed", () => {
    const c = parseConflict(
      err("already_reviewed", { current_version: 2, reviewed_by: sarah, reviewed_at: "2026-10-15T09:40:00Z" }),
    );
    expect(c).toMatchObject({ kind: "already_reviewed", reviewedBy: sarah, reviewedAt: "2026-10-15T09:40:00Z" });
  });

  it("classes a version_conflict whose last change was the review as already_reviewed", () => {
    const c = parseConflict(
      err("version_conflict", {
        current_version: 2,
        review_status: "reviewed",
        reviewed_by: sarah,
        reviewed_at: "2026-10-15T09:40:00Z",
        last_changed_by: sarah,
        last_changed_at: "2026-10-15T09:40:00Z",
      }),
    );
    expect(c?.kind).toBe("already_reviewed");
  });

  it("classes any other version_conflict as stale and keeps current values", () => {
    const c = parseConflict(
      err("version_conflict", {
        current_version: 3,
        review_status: "awaiting_review",
        reviewed_by: null,
        reviewed_at: null,
        last_changed_by: sarah,
        last_changed_at: "2026-10-15T09:40:00Z",
        current: { painter_notes: "Sarah's text" },
      }),
    );
    expect(c).toMatchObject({ kind: "stale", lastChangedBy: sarah, current: { painter_notes: "Sarah's text" } });
    // reviewed, but edited after the review: stale
    const d = parseConflict(
      err("version_conflict", {
        review_status: "reviewed",
        reviewed_at: "2026-10-15T09:40:00Z",
        last_changed_at: "2026-10-15T09:45:00Z",
      }),
    );
    expect(d?.kind).toBe("stale");
  });

  it("returns null for anything else", () => {
    expect(parseConflict(err("not_found", {}, 404))).toBeNull();
    expect(parseConflict(err("validation_error", {}, 422))).toBeNull();
    expect(parseConflict(new Error("x"))).toBeNull();
    expect(parseConflict(undefined)).toBeNull();
  });
});

const event = (over: Partial<AuditEvent>): AuditEvent => ({
  id: "e1",
  occurred_at: "2026-10-15T10:42:00Z",
  actor: priya,
  action: "report.edited",
  changes: [],
  ...over,
});

describe("describeEvent", () => {
  it("reviewed", () => {
    expect(describeEvent(event({ action: "report.reviewed" })).sentence).toBe("Priya Nair marked the report as reviewed");
  });

  it("reopened names the earlier review in London time", () => {
    const d = describeEvent(
      event({
        action: "report.reopened",
        changes: [
          { field: "review_status", item_id: null, item_label: null, old_value: "reviewed", new_value: "awaiting_review" },
          { field: "reviewed_by", item_id: null, item_label: null, old_value: "Sarah Whitfield", new_value: null },
          { field: "reviewed_at", item_id: null, item_label: null, old_value: "2026-10-12T08:15:00Z", new_value: null },
        ],
      }),
    );
    expect(d.sentence).toBe(
      "Report returned to Awaiting review (previously reviewed by Sarah Whitfield on 12 Oct 2026, 09:15)",
    );
  });

  it("edited lists fields once and formats values", () => {
    const d = describeEvent(
      event({
        changes: [
          { field: "painter_notes", item_id: null, item_label: null, old_value: null, new_value: "New" },
          { field: "checklist_done", item_id: "c1", item_label: "Skirting boards gloss", old_value: false, new_value: true },
          { field: "checklist_note", item_id: "c1", item_label: "Skirting boards gloss", old_value: "a", new_value: null },
        ],
      }),
    );
    expect(d.sentence).toBe("Priya Nair changed Painter notes, Checklist: Skirting boards gloss");
    expect(d.changes).toEqual([
      { label: "Painter notes", old: "(empty)", new: "New" },
      { label: "Checklist: Skirting boards gloss", old: "Not done", new: "Done" },
      { label: "Checklist note: Skirting boards gloss", old: "a", new: "(empty)" },
    ]);
  });

  it("settings", () => {
    const d = describeEvent(
      event({
        actor: { id: "a", name: "Tom Ashworth" },
        action: "settings.changed",
        changes: [
          { field: "company_name", item_id: null, item_label: null, old_value: "A", new_value: "B" },
          { field: "theme_primary", item_id: null, item_label: null, old_value: "#111111", new_value: "#222222" },
        ],
      }),
    );
    expect(d.sentence).toBe("Tom Ashworth changed Company name, Primary colour");
  });

  it("truncates by code points", () => {
    expect(truncate("abc", 200)).toEqual({ short: "abc", isTruncated: false });
    const t = truncate("\u{1F3A8}".repeat(250), 200);
    expect(t.isTruncated).toBe(true);
    expect(Array.from(t.short)).toHaveLength(201);
  });
});

const report = {
  id: "r1",
  version: 4,
  painter_notes: "Original",
  manager_notes: null,
  checklist: [
    { id: "c1", label: "Skirting boards gloss", done: false, note: null },
    { id: "c2", label: "Doors", done: true, note: "ok" },
  ],
} as unknown as ReportDetail;

describe("buildReportUpdate", () => {
  const base = (): FormValues => formFromReport(report);

  it("is null when nothing changed, including blank vs null", () => {
    expect(buildReportUpdate(report, base())).toBeNull();
    expect(buildReportUpdate(report, { ...base(), manager_notes: "   " })).toBeNull();
  });

  it("sends only changed keys with the loaded version", () => {
    const form = base();
    form.painter_notes = "Changed";
    form.checklist.c1 = { done: true, note: "" };
    expect(buildReportUpdate(report, form)).toEqual({
      version: 4,
      painter_notes: "Changed",
      checklist: [{ id: "c1", done: true }],
    });
  });

  it("clearing a note sends null, notes are kept exactly as typed", () => {
    const form = base();
    form.painter_notes = "";
    form.manager_notes = "  keep my spaces \n";
    form.checklist.c2 = { done: true, note: "" };
    expect(buildReportUpdate(report, form)).toEqual({
      version: 4,
      painter_notes: null,
      manager_notes: "  keep my spaces \n",
      checklist: [{ id: "c2", note: null }],
    });
  });
});

describe("validateForm", () => {
  it("counts code points and reports the limits", () => {
    const form = formFromReport(report);
    expect(hasProblems(validateForm(form))).toBe(false);
    form.painter_notes = "\u{1F3A8}".repeat(5000);
    expect(textLength(form.painter_notes)).toBe(5000);
    expect(hasProblems(validateForm(form))).toBe(false);
    form.painter_notes += "x";
    form.checklist.c1 = { done: false, note: "y".repeat(501) };
    const p = validateForm(form);
    expect(p.painter_notes).toBe("Use 5,000 characters or fewer.");
    expect(p.checklist.c1).toBe("Use 500 characters or fewer.");
    form.manager_notes = "a\u0000b";
    expect(validateForm(form).manager_notes).toBe("Remove NUL characters.");
  });
});

describe("currentMatchesUpdate", () => {
  it("recognises a retry of a request that already succeeded", () => {
    const update = { version: 4, painter_notes: "Mine", checklist: [{ id: "c1", done: true, note: "x" }] };
    expect(
      currentMatchesUpdate({ painter_notes: "Mine", checklist: [{ id: "c1", done: true, note: "x" }] }, update),
    ).toBe(true);
    expect(
      currentMatchesUpdate({ painter_notes: "Theirs", checklist: [{ id: "c1", done: true, note: "x" }] }, update),
    ).toBe(false);
    expect(currentMatchesUpdate({ painter_notes: "Mine", checklist: [{ id: "c1", done: false, note: "x" }] }, update)).toBe(
      false,
    );
    expect(currentMatchesUpdate({ painter_notes: null }, { version: 1, painter_notes: "  " })).toBe(true);
    expect(currentMatchesUpdate(undefined, update)).toBe(false);
  });
});

describe("formatTime", () => {
  it("shows London time", () => {
    expect(formatTime("2026-10-15T10:40:00Z")).toBe("11:40"); // BST
    expect(formatTime("2026-12-15T10:40:00Z")).toBe("10:40"); // GMT
  });
});
