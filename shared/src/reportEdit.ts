import type { ChecklistItemUpdate, ReportDetail, ReportEditableValues, ReportUpdate } from "./generated";
import { WORDING } from "./format/labels";
import type { Flat, FlatValue, MergeAdapter } from "./merge";

export const NOTES_MAX = 5000;
export const CHECKLIST_NOTE_MAX = 500;

export interface ChecklistFormValue {
  done: boolean;
  note: string;
}

/** What the edit form holds: plain strings, so the manager's text is kept exactly as typed. */
export interface FormValues {
  painter_notes: string;
  manager_notes: string;
  /** By checklist item id. */
  checklist: Record<string, ChecklistFormValue>;
}

export function formFromReport(report: ReportDetail): FormValues {
  return {
    painter_notes: report.painter_notes ?? "",
    manager_notes: report.manager_notes ?? "",
    checklist: Object.fromEntries(report.checklist.map((i) => [i.id, { done: i.done, note: i.note ?? "" }])),
  };
}

/** Length in code points, the way the server counts. */
export function textLength(value: string): number {
  return Array.from(value).length;
}

/** The server stores a blank string as null and keeps anything else exactly as sent. */
export function blankToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

export function overLimitMessage(max: number): string {
  return `Use ${max.toLocaleString("en-GB")} characters or fewer.`;
}

export interface FormProblems {
  painter_notes?: string;
  manager_notes?: string;
  checklist: Record<string, string>;
}

// eslint-disable-next-line no-control-regex
const NUL = /\u0000/;

function problemFor(value: string, max: number): string | undefined {
  if (NUL.test(value)) return "Remove NUL characters.";
  if (textLength(value) > max) return overLimitMessage(max);
  return undefined;
}

/** Client-side limits, the same as the server's (it still has the final say). */
export function validateForm(form: FormValues): FormProblems {
  const problems: FormProblems = { checklist: {} };
  const painter = problemFor(form.painter_notes, NOTES_MAX);
  const manager = problemFor(form.manager_notes, NOTES_MAX);
  if (painter) problems.painter_notes = painter;
  if (manager) problems.manager_notes = manager;
  for (const [id, item] of Object.entries(form.checklist)) {
    const p = problemFor(item.note, CHECKLIST_NOTE_MAX);
    if (p) problems.checklist[id] = p;
  }
  return problems;
}

export function hasProblems(problems: FormProblems): boolean {
  return Boolean(problems.painter_notes || problems.manager_notes || Object.keys(problems.checklist).length > 0);
}

/**
 * The PATCH body for what the manager changed, or null when nothing changed. Only changed keys are
 * sent. `version` is the version the form was loaded from.
 */
export function buildReportUpdate(original: ReportDetail, form: FormValues): ReportUpdate | null {
  const update: ReportUpdate = { version: original.version };
  let changed = false;

  const painter = blankToNull(form.painter_notes);
  if (painter !== blankToNull(original.painter_notes ?? "")) {
    update.painter_notes = painter;
    changed = true;
  }
  const manager = blankToNull(form.manager_notes);
  if (manager !== blankToNull(original.manager_notes ?? "")) {
    update.manager_notes = manager;
    changed = true;
  }

  const items: ChecklistItemUpdate[] = [];
  for (const item of original.checklist) {
    const value = form.checklist[item.id];
    if (!value) continue;
    const entry: ChecklistItemUpdate = { id: item.id };
    if (value.done !== item.done) entry.done = value.done;
    const note = blankToNull(value.note);
    if (note !== blankToNull(item.note ?? "")) entry.note = note;
    if (entry.done !== undefined || entry.note !== undefined) items.push(entry);
  }
  if (items.length > 0) {
    update.checklist = items;
    changed = true;
  }
  return changed ? update : null;
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  blankToNull(a ?? "") === blankToNull(b ?? "");

/**
 * True when the server's current values (from a 409 on PATCH) already equal what the update tried
 * to set. This is how a retry of a request that actually succeeded is recognised.
 */
export function currentMatchesUpdate(current: ReportEditableValues | undefined, update: ReportUpdate): boolean {
  if (!current) return false;
  if ("painter_notes" in update && !sameText(current.painter_notes, update.painter_notes)) return false;
  if ("manager_notes" in update && !sameText(current.manager_notes, update.manager_notes)) return false;
  for (const sent of update.checklist ?? []) {
    const now = current.checklist?.find((i) => i.id === sent.id);
    if (!now) return false;
    if (sent.done !== undefined && sent.done !== now.done) return false;
    if ("note" in sent && !sameText(now.note, sent.note)) return false;
  }
  return true;
}

/** Keys used by the merge: `painter_notes`, `manager_notes`, `checklist:<id>:done`, `checklist:<id>:note`. */
export const checklistKey = (id: string, part: "done" | "note") => `checklist:${id}:${part}`;

/**
 * Merge adapter for the report form (T-002o). `labels` names checklist items; pass the report's
 * checklist so "Checklist: Ceilings (note)" can be built.
 */
export function reportMergeAdapter(items: { id: string; label: string }[]): MergeAdapter<FormValues> {
  const names = new Map(items.map((i) => [i.id, i.label]));
  return {
    flatten(form) {
      const flat: Flat = { painter_notes: form.painter_notes, manager_notes: form.manager_notes };
      for (const [id, v] of Object.entries(form.checklist)) {
        flat[checklistKey(id, "done")] = v.done;
        flat[checklistKey(id, "note")] = v.note;
      }
      return flat;
    },
    unflatten(flat, like) {
      const checklist: FormValues["checklist"] = {};
      for (const id of Object.keys(like.checklist)) {
        checklist[id] = {
          done: Boolean(flat[checklistKey(id, "done")]),
          note: String(flat[checklistKey(id, "note")] ?? ""),
        };
      }
      return {
        painter_notes: String(flat.painter_notes ?? ""),
        manager_notes: String(flat.manager_notes ?? ""),
        checklist,
      };
    },
    normalise(_key: string, value: FlatValue) {
      return typeof value === "boolean" ? value : blankToNull(value);
    },
    label(key) {
      if (key === "painter_notes") return WORDING.fieldWorkerNotes;
      if (key === "manager_notes") return "Manager notes";
      const [, id, part] = key.split(":");
      const name = names.get(id ?? "") ?? "item";
      return `Checklist: ${name} (${part === "done" ? "done" : "note"})`;
    },
  };
}
