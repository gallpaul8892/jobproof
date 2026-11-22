import type { ChecklistStateRow, DraftRow } from "../../db/draftRepo";
import { checklist, makeJob } from "../../../test/jobFixtures";
import { applyLocal } from "./localView";

const state = (item_id: string, over: Partial<ChecklistStateRow> = {}): ChecklistStateRow => ({ owner_user_id: "dan", job_id: "job-lounge", item_id, status: "done", note: null, rev: 1, synced_rev: 0, ...over });
const draft = (over: Partial<DraftRow> = {}): DraftRow => ({ owner_user_id: "dan", job_id: "job-lounge", notes: null, notes_rev: 0, notes_synced_rev: 0, local_state: "draft", last_error_code: null, ...over });

describe("applyLocal: local value while rev > synced_rev, else the server's", () => {
  const items = checklist(3);
  const server = makeJob({ id: "job-lounge", checklist: items, checklist_total: 3, checklist_dealt_with: 0 });

  it("an unchanged job shows exactly what the server says", () => {
    const view = applyLocal({ ...server, checklist_dealt_with: 2 }, undefined, []);
    expect(view.job.checklist_dealt_with).toBe(2);
    expect(view.job.checklist).toEqual(server.checklist);
    expect(view.notes).toBeNull();
  });

  it("scenario 1 and 12: a local tick counts, and unticking takes it away", () => {
    expect(applyLocal(server, undefined, [state("job-lounge-item-1")]).job.checklist_dealt_with).toBe(1);
    expect(applyLocal(server, undefined, [state("job-lounge-item-1", { status: "open" })]).job.checklist_dealt_with).toBe(0);
  });

  it("scenario 3: not done counts only with a reason", () => {
    expect(applyLocal(server, undefined, [state("job-lounge-item-2", { status: "not_done", note: null })]).job.checklist_dealt_with).toBe(0);
    expect(applyLocal(server, undefined, [state("job-lounge-item-2", { status: "not_done", note: "Customer took the tin" })]).job.checklist_dealt_with).toBe(1);
  });

  it("a synced row is ignored (the server's value is shown)", () => {
    const view = applyLocal(server, undefined, [state("job-lounge-item-1", { status: "done", rev: 2, synced_rev: 2 })]);
    expect(view.job.checklist[0]!.status).toBe("open");
    expect(view.job.checklist_dealt_with).toBe(0);
  });

  it("the local note wins while unsent, the server's after", () => {
    const withNote = { ...server, report: { id: "r", state: "draft", notes: "server note" } as never };
    expect(applyLocal(withNote, draft({ notes: "mine", notes_rev: 1 }), []).notes).toBe("mine");
    expect(applyLocal(withNote, draft({ notes: "mine", notes_rev: 1, notes_synced_rev: 1 }), []).notes).toBe("server note");
    expect(applyLocal(withNote, draft({ notes: null, notes_rev: 2 }), []).notes).toBeNull();
  });

  it("scenario 10: a removed item does not count, and unsent changes to an item the server dropped are kept as orphans", () => {
    const removed = [...items, { id: "gone", position: 4, label: "Old item", status: "done" as const, note: "kept", removed: true }];
    const view = applyLocal({ ...server, checklist: removed, checklist_dealt_with: 0 }, undefined, [state("job-lounge-item-1"), state("vanished", { note: "x" })]);
    expect(view.job.checklist_dealt_with).toBe(1);
    expect(view.orphans.map((o) => o.item_id)).toEqual(["vanished"]);
  });

  it("copes with a cached job that has no checklist array", () => {
    const bare = { ...server, checklist: undefined } as never;
    expect(applyLocal(bare, undefined, []).job).toBe(bare);
  });
});
