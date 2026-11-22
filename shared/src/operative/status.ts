import type { OperativeChecklistItem, OperativeJob, OperativeJobStatus } from "../generated";

/** The short status word, without progress: "To do", "In progress", "Submitted", ... */
const WORDS: Record<OperativeJobStatus, string> = {
  to_do: "To do",
  in_progress: "In progress",
  submitted: "Submitted",
  completed_by_office: "Completed by office",
  cancelled: "Cancelled",
};

/** Text glyphs, so the status never relies on colour alone and no icon font has to ship. */
const ICONS: Record<OperativeJobStatus, string> = {
  to_do: "○",
  in_progress: "◐",
  submitted: "✓",
  completed_by_office: "✓",
  cancelled: "✕",
};

type StatusLike = Pick<OperativeJob, "status">;

export function operativeStatusWord(job: StatusLike): string {
  return WORDS[job.status] ?? "Unknown";
}

export function operativeStatusIcon(job: StatusLike): string {
  return ICONS[job.status] ?? "?";
}

/** "0 of 9 done". */
export function checklistSummary(job: Pick<OperativeJob, "checklist_dealt_with" | "checklist_total">): string {
  return `${job.checklist_dealt_with} of ${job.checklist_total} done`;
}

/**
 * The status line for a job: "To do", "In progress, 6 of 9 done", "Submitted", "Completed by
 * office", "Cancelled". A job in progress with no checklist is just "In progress".
 * (Named apart from the manager's `jobStatusLabel(JobStatus)`.)
 */
export function operativeJobStatusLabel(job: Pick<OperativeJob, "status" | "checklist_dealt_with" | "checklist_total">): string {
  if (job.status === "in_progress" && job.checklist_total > 0) return `${WORDS.in_progress}, ${checklistSummary(job)}`;
  return operativeStatusWord(job);
}

/** Nothing more for the operative to do on this job: shown greyed in the list. */
export function isFinishedJob(job: StatusLike): boolean {
  return job.status === "submitted" || job.status === "completed_by_office" || job.status === "cancelled";
}

/** Stable: open jobs keep the server's (scheduled) order, finished jobs sit below them. */
export function orderJobsForDisplay<T extends StatusLike>(jobs: readonly T[]): T[] {
  return [...jobs.filter((j) => !isFinishedJob(j)), ...jobs.filter(isFinishedJob)];
}

/**
 * What a checklist row says about its state (T-003f scenario 3): "Not done yet", "Done",
 * "Not done: <reason>". A not-done item with no reason is shown as incomplete.
 */
export function checklistItemStateLabel(item: Pick<OperativeChecklistItem, "status" | "note">): string {
  if (item.status === "done") return "Done";
  if (item.status === "not_done") return (item.note ?? "").trim() !== "" ? `Not done: ${item.note}` : "Not done: add a reason";
  return "Not done yet";
}

/** Counts as dealt with for submission: done, or not done with a reason (P2). */
export function isDealtWith(item: Pick<OperativeChecklistItem, "status" | "note">): boolean {
  return item.status === "done" || (item.status === "not_done" && (item.note ?? "").trim() !== "");
}
