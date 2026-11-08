import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  CHECKLIST_NOTE_MAX,
  NOTES_MAX,
  buildReportUpdate,
  checklistKey,
  currentMatchesUpdate,
  formFromReport,
  formatTime,
  hasProblems,
  parseConflict,
  reportMergeAdapter,
  textLength,
  useFetchLatestReport,
  useMe,
  useUpdateReport,
  validateForm,
  type Conflict,
  type FormValues,
  type ReportDetail,
  type ReportUpdate,
  WORDING,
} from "@jobproof/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CLASH_HINT, ClashChoice, MergeNotice, NothingLeftNotice, ReappliedTag } from "../../components/ConflictMerge";
import { useMergeOnTop } from "../../components/useMergeOnTop";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type Failure =
  | { kind: "conflict"; conflict: Conflict }
  | { kind: "fields"; fields: Map<string, string>; general: string[] }
  | { kind: "forbidden" }
  | { kind: "retry"; network: boolean };

const count = (n: number, max: number) => `${n.toLocaleString("en-GB")} / ${max.toLocaleString("en-GB")}`;

function CurrentValue({ children, testId }: { children: string; testId: string }) {
  return (
    <div className="current-value" data-testid={testId}>
      <span className="current-value-label">Current saved value:</span>
      <span className="prewrap">{children === "" ? "(empty)" : children}</span>
    </div>
  );
}

function NotesField({
  id,
  label,
  value,
  max,
  problem,
  currentValue,
  testId,
  readOnly,
  tag,
  clash,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  problem: string | undefined;
  currentValue: string | null | undefined;
  testId: string;
  readOnly?: boolean;
  tag?: boolean;
  clash?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        {tag && <ReappliedTag />}
      </div>
      {clash}
      <textarea
        id={id}
        rows={5}
        value={value}
        readOnly={readOnly}
        data-testid={`${testId}-input`}
        aria-invalid={problem ? "true" : undefined}
        aria-describedby={`${id}-meta`}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="field-meta" id={`${id}-meta`}>
        <span className="field-error" data-testid={`${testId}-error`}>
          {problem}
        </span>
        <span className="muted small" data-testid={`${testId}-count`}>
          {count(textLength(value), max)}
        </span>
      </div>
      {currentValue !== undefined && <CurrentValue testId={`${testId}-current`}>{currentValue ?? ""}</CurrentValue>}
    </div>
  );
}

/**
 * Edit painter notes, manager notes and the checklist in one form. The report the form started from is
 * kept (its version is what is sent), so a background refresh can never silently move the version
 * forward and let a save overwrite another manager's change.
 */
export function EditReportForm({
  report,
  onSaved,
  onClose,
  onReload,
}: {
  report: ReportDetail;
  /** `refetch` is true when the save is only known from a 409, so the cache does not hold it yet. */
  onSaved: (refetch: boolean) => void;
  onClose: () => void;
  /** Loads the latest report and restarts the form from it. Rejects if the report cannot be loaded. */
  onReload: () => Promise<void>;
}) {
  const [original, setOriginal] = useState(report);
  const [form, setForm] = useState<FormValues>(() => formFromReport(report));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastBody, setLastBody] = useState<ReportUpdate | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "reload" | null>(null);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const mutation = useUpdateReport(original.id);
  const fetchLatest = useFetchLatestReport(original.id);
  const adapter = reportMergeAdapter(original.checklist);
  const mergeFlow = useMergeOnTop({ adapter, original, form, setForm, setOriginal, fetchLatest, toForm: formFromReport });
  const { merge } = mergeFlow;
  const formRef = useRef<HTMLFormElement>(null);
  const me = useMe();
  const idBase = useId();
  const saving = useRef(false);

  const update = buildReportUpdate(original, form);
  const problems = validateForm(form);
  const dirty = update !== null;
  const blocker = useUnsavedChangesGuard(dirty);
  const canSave = dirty && !hasProblems(problems) && !mutation.isPending && mergeFlow.unresolved === 0;
  const nothingLeft = merge !== null && mergeFlow.unresolved === 0 && !dirty;

  // After applying on top, move focus to the first field that needs a choice, else to the notice.
  const mergeSeq = merge?.seq;
  useEffect(() => {
    if (mergeSeq === undefined) return;
    const target =
      formRef.current?.querySelector<HTMLElement>("[data-clash]") ??
      formRef.current?.querySelector<HTMLElement>("[data-merge-focus]");
    target?.focus();
  }, [mergeSeq]);

  const conflict = failure?.kind === "conflict" ? failure.conflict : null;
  const serverFields = failure?.kind === "fields" ? failure.fields : null;
  const currentChecklist = new Map(conflict?.current?.checklist?.map((i) => [i.id, i]));
  const sentPainter = lastBody !== null && "painter_notes" in lastBody;
  const sentManager = lastBody !== null && "manager_notes" in lastBody;

  function clashView(key: string, testId: string): ReactNode {
    const clash = mergeFlow.clashFor(key);
    if (!clash || !merge) return null;
    return (
      <ClashChoice
        clash={clash}
        by={merge.by}
        choice={merge.choices[key]}
        onChoose={(c) => mergeFlow.choose(key, c)}
        testId={testId}
      />
    );
  }

  function change(patch: Partial<FormValues>) {
    setForm((f) => ({ ...f, ...patch }));
  }
  function changeItem(id: string, patch: Partial<FormValues["checklist"][string]>) {
    setForm((f) => ({ ...f, checklist: { ...f.checklist, [id]: { ...f.checklist[id]!, ...patch } } }));
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave || saving.current) return;
    const body = update!;
    saving.current = true;
    setFailure(null);
    setLastBody(body);
    mutation.mutate(body, {
      onSuccess: () => onSaved(false),
      onError: (error) => {
        const found = parseConflict(error);
        if (found) {
          // A retry of a request that really succeeded: our own change is what is saved now.
          if (found.lastChangedBy?.id !== undefined && found.lastChangedBy.id === me.data?.id && currentMatchesUpdate(found.current, body)) {
            onSaved(true);
            return;
          }
          setFailure({ kind: "conflict", conflict: found });
        } else if (error instanceof ApiError && error.status === 422) {
          const fields = new Map<string, string>();
          const general: string[] = [];
          for (const e of error.fieldErrors) {
            const [, key, index, sub] = e.loc;
            if (key === "painter_notes" || key === "manager_notes") fields.set(key, e.message);
            else if (key === "checklist" && typeof index === "number" && body.checklist?.[index]) {
              fields.set(`${body.checklist[index]!.id}:${String(sub)}`, e.message);
            } else general.push(e.message);
          }
          setFailure({ kind: "fields", fields, general });
        } else if (error instanceof ApiError && error.status === 403) {
          setFailure({ kind: "forbidden" });
        } else {
          setFailure({ kind: "retry", network: error instanceof ApiError && error.status === 0 });
        }
      },
      onSettled: () => {
        saving.current = false;
      },
    });
  }

  async function applyOnTop() {
    if (mergeFlow.applying) return;
    // A failed load leaves the form, the conflict view and the base exactly as they were.
    if (await mergeFlow.apply()) {
      setFailure(null);
      setLastBody(null);
    }
  }

  function cancel() {
    if (dirty) setConfirm("cancel");
    else onClose();
  }

  const reviewed = original.review_status === "reviewed";

  return (
    <>
      <form
        ref={formRef}
        className="panel panel-wide edit-form"
        aria-labelledby={`${idBase}-heading`}
        onSubmit={submit}
        noValidate
        data-testid="edit-form"
      >
        <h2 id={`${idBase}-heading`}>Edit report</h2>

        {reviewed && (
          <p role="status" className="notice" data-testid="reopen-notice">
            This report has been reviewed. Saving changes will return it to Awaiting review.
          </p>
        )}

        {merge && <MergeNotice by={merge.by} at={merge.at} />}
        {nothingLeft && <NothingLeftNotice />}

        {failure?.kind === "conflict" && (
          <div role="alert" className="alert edit-alert" data-testid="edit-conflict">
            <p>
              {failure.conflict.lastChangedBy
                ? `${failure.conflict.lastChangedBy.name} changed this report${
                    failure.conflict.lastChangedAt ? ` at ${formatTime(failure.conflict.lastChangedAt)}` : ""
                  }.`
                : "Someone else changed this report."}{" "}
              Your changes were not saved.
            </p>
            <p className="small">Your text is still in the form so you can copy it. The saved values are shown beside each field.</p>
            <div className="alert-actions">
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => void applyOnTop()}
                data-testid="apply-on-top"
                disabled={mergeFlow.applying || reloading}
              >
                {mergeFlow.applying ? "Loading latest..." : "Apply my changes on top"}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setConfirm("reload")}
                data-testid="reload-latest"
                disabled={reloading || mergeFlow.applying}
              >
                Reload latest
              </button>
            </div>
            {reloading && <p className="small">Loading the latest version...</p>}
            {(reloadFailed || mergeFlow.applyFailed) && (
              <p role="alert" className="small" data-testid={mergeFlow.applyFailed ? "apply-failed" : "reload-failed"}>
                Could not load the latest version.{" "}
                {mergeFlow.applyFailed && (
                  <button type="button" className="btn btn-small" onClick={() => void applyOnTop()} data-testid="apply-retry">
                    Try again
                  </button>
                )}
                {!mergeFlow.applyFailed && "Try again."}
              </p>
            )}
          </div>
        )}
        {failure?.kind === "forbidden" && (
          <p role="alert" className="alert edit-alert" data-testid="edit-forbidden">
            You no longer have permission to edit this report.
          </p>
        )}
        {failure?.kind === "retry" && (
          <div role="alert" className="alert edit-alert" data-testid="edit-failure">
            <p>
              Could not save your changes.{" "}
              {failure.network ? "Can't reach the server." : "Something went wrong."} Nothing was lost.
            </p>
            <button type="button" className="btn btn-small" onClick={() => submit()} disabled={mutation.isPending} data-testid="edit-retry">
              Try again
            </button>
          </div>
        )}
        {failure?.kind === "fields" && failure.general.length > 0 && (
          <p role="alert" className="alert edit-alert" data-testid="edit-invalid">
            {failure.general.join(" ")}
          </p>
        )}

        <NotesField
          id={`${idBase}-painter`}
          label={WORDING.fieldWorkerNotes}
          testId="painter-notes"
          value={form.painter_notes}
          max={NOTES_MAX}
          problem={problems.painter_notes ?? serverFields?.get("painter_notes")}
          currentValue={conflict && sentPainter ? (conflict.current?.painter_notes ?? null) : undefined}
          readOnly={mergeFlow.locked("painter_notes")}
          tag={mergeFlow.reapplied("painter_notes")}
          clash={clashView("painter_notes", "painter-notes-clash")}
          onChange={(v) => change({ painter_notes: v })}
        />
        <NotesField
          id={`${idBase}-manager`}
          label="Manager notes (internal)"
          testId="manager-notes"
          value={form.manager_notes}
          max={NOTES_MAX}
          problem={problems.manager_notes ?? serverFields?.get("manager_notes")}
          currentValue={conflict && sentManager ? (conflict.current?.manager_notes ?? null) : undefined}
          readOnly={mergeFlow.locked("manager_notes")}
          tag={mergeFlow.reapplied("manager_notes")}
          clash={clashView("manager_notes", "manager-notes-clash")}
          onChange={(v) => change({ manager_notes: v })}
        />

        <h3>Checklist</h3>
        {original.checklist.length === 0 ? (
          <p className="muted">No checklist was submitted.</p>
        ) : (
          <ul className="edit-checklist">
            {original.checklist.map((item) => {
              const value = form.checklist[item.id]!;
              const problem = problems.checklist[item.id] ?? serverFields?.get(`${item.id}:note`);
              const now = currentChecklist.get(item.id);
              const noteId = `${idBase}-note-${item.id}`;
              return (
                <li key={item.id} data-testid="edit-check-item">
                  <div className="edit-check-head">
                    <span className="edit-check-label">{item.label}</span>
                    {mergeFlow.reapplied(checklistKey(item.id, "done")) && <ReappliedTag />}
                    <label className="check-box">
                      <input
                        type="checkbox"
                        checked={value.done}
                        disabled={mergeFlow.locked(checklistKey(item.id, "done"))}
                        aria-label={`Done, ${item.label}`}
                        data-testid="edit-check-done"
                        onChange={(e) => changeItem(item.id, { done: e.target.checked })}
                      />
                      Done
                    </label>
                  </div>
                  {clashView(checklistKey(item.id, "done"), "edit-check-done-clash")}
                  <div className="field">
                    <div className="label-row">
                      <label htmlFor={noteId} className="sr-only">
                        Note for {item.label}
                      </label>
                      {mergeFlow.reapplied(checklistKey(item.id, "note")) && <ReappliedTag />}
                    </div>
                    {clashView(checklistKey(item.id, "note"), "edit-check-note-clash")}
                    <input
                      id={noteId}
                      value={value.note}
                      readOnly={mergeFlow.locked(checklistKey(item.id, "note"))}
                      placeholder="Note (optional)"
                      autoComplete="off"
                      data-testid="edit-check-note"
                      aria-invalid={problem ? "true" : undefined}
                      aria-describedby={`${noteId}-meta`}
                      onChange={(e) => changeItem(item.id, { note: e.target.value })}
                    />
                    <div className="field-meta" id={`${noteId}-meta`}>
                      <span className="field-error">{problem}</span>
                      <span className="muted small">{count(textLength(value.note), CHECKLIST_NOTE_MAX)}</span>
                    </div>
                    {now && (
                      <CurrentValue testId="edit-check-current">
                        {`${now.done ? "Done" : "Not done"}${now.note ? `. Note: ${now.note}` : ""}`}
                      </CurrentValue>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {mergeFlow.unresolved > 0 && (
          <p className="small muted" id={`${idBase}-hint`} data-testid="clash-hint">
            {CLASH_HINT}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!canSave} data-testid="save-changes" aria-describedby={mergeFlow.unresolved > 0 ? `${idBase}-hint` : undefined} aria-busy={mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Save changes"}
          </button>
          <button type="button" className="btn" onClick={cancel} disabled={mutation.isPending} data-testid="cancel-edit">
            Cancel
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirm === "cancel"}
        title="Discard your changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        testId="discard-dialog"
        onConfirm={() => {
          setConfirm(null);
          onClose();
        }}
        onCancel={() => setConfirm(null)}
      >
        <p>Your edits have not been saved.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "reload"}
        title="Discard your edits and load the latest version?"
        confirmLabel="Discard and reload"
        cancelLabel="Keep editing"
        testId="reload-dialog"
        onConfirm={() => {
          setConfirm(null);
          setReloadFailed(false);
          setReloading(true);
          // On failure keep the form, the typed text and the conflict view.
          onReload()
            .then(() => setFailure(null))
            .catch(() => setReloadFailed(true))
            .finally(() => setReloading(false));
        }}
        onCancel={() => setConfirm(null)}
      >
        <p>Copy anything you want to keep first. Nothing you typed has been saved.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Leave without saving?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        testId="leave-dialog"
        onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
        onCancel={() => blocker.state === "blocked" && blocker.reset()}
      >
        <p>You have unsaved changes to this report.</p>
      </ConfirmDialog>
    </>
  );
}
