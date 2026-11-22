import { useMemo } from "react";
import { isDealtWith, type OperativeChecklistItem, type OperativeJob } from "@jobproof/shared";
import { useDraftRows } from "../../db/localStore";
import type { ChecklistStateRow, DraftRow } from "../../db/draftRepo";

/** A job as this phone shows it: the server's job with the operative's unsent changes on top. */
export interface LocalView {
  /** Items and the dealt-with count with local values applied (the server's `report` and the rest are untouched). */
  job: OperativeJob;
  /** The overall job note to show. */
  notes: string | null;
  /** Unsent changes to items the server no longer lists (removed after the operative edited them). */
  orphans: ChecklistStateRow[];
}

/**
 * Local display rule (T-003f): the local value while `rev > synced_rev`, else the server's. Pure,
 * so the rule is tested without a screen.
 */
export function applyLocal(server: OperativeJob, draft: DraftRow | undefined, states: readonly ChecklistStateRow[]): LocalView {
  if (!Array.isArray(server.checklist)) return { job: server, notes: server.report?.notes ?? null, orphans: [] };
  const dirty = new Map(states.filter((s) => s.rev > s.synced_rev).map((s) => [s.item_id, s]));
  const checklist: OperativeChecklistItem[] = server.checklist.map((item) => {
    const local = dirty.get(item.id);
    return local ? { ...item, status: local.status, note: local.note } : item;
  });
  const countOf = (items: OperativeChecklistItem[]) => items.filter((i) => !i.removed).filter(isDealtWith).length;
  // The server's own count, moved by what the local changes add or take away (so an unchanged job shows exactly the server's number).
  const dealtWith = Math.max(0, server.checklist_dealt_with + countOf(checklist) - countOf(server.checklist));
  const known = new Set(server.checklist.map((i) => i.id));
  const notes = draft && draft.notes_rev > draft.notes_synced_rev ? draft.notes : (server.report?.notes ?? null);
  return {
    job: { ...server, checklist, checklist_dealt_with: dealtWith },
    notes,
    orphans: [...dirty.values()].filter((s) => !known.has(s.item_id)),
  };
}

export function useLocalView(server: OperativeJob): LocalView {
  const { draft, states } = useDraftRows(server.id);
  return useMemo(() => applyLocal(server, draft, states), [server, draft, states]);
}
