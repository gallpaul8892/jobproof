import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  CUSTOMER_FIELDS,
  CUSTOMER_FIELD_LABELS,
  FIELD_MAX,
  buildCustomerUpdate,
  customerCurrentMatchesUpdate,
  customerMergeAdapter,
  formFromCustomer,
  formatTime,
  hasCustomerProblems,
  impactNotice,
  parseCustomerConflict,
  trimmedLength,
  useFetchLatestCustomer,
  useMe,
  useUpdateCustomer,
  validateCustomerForm,
  type Conflict,
  type CustomerEditableValues,
  type CustomerField,
  type CustomerFormValues,
  type CustomerRecord,
  type CustomerUpdate,
} from "@jobproof/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CLASH_HINT, ClashChoice, MergeNotice, NothingLeftNotice, ReappliedTag } from "../../components/ConflictMerge";
import { useMergeOnTop } from "../../components/useMergeOnTop";
import { useUnsavedChangesGuard } from "../report/useUnsavedChangesGuard";

type Failure =
  | { kind: "conflict"; conflict: Conflict<CustomerEditableValues> }
  | { kind: "fields"; fields: Map<string, string>; general: string[] }
  | { kind: "forbidden" }
  | { kind: "retry"; network: boolean };

const ADDRESS: readonly CustomerField[] = ["line1", "line2", "town", "county", "postcode"];
const isAddress = (f: CustomerField) => ADDRESS.includes(f);
const mergeKey = (f: CustomerField) => (isAddress(f) ? `billing_address.${f}` : f);
const INPUT: Record<CustomerField, { type: string; inputMode?: "email" | "tel" | "text" }> = {
  name: { type: "text" },
  contact_name: { type: "text" },
  email: { type: "email", inputMode: "email" },
  phone: { type: "tel", inputMode: "tel" },
  line1: { type: "text" },
  line2: { type: "text" },
  town: { type: "text" },
  county: { type: "text" },
  postcode: { type: "text" },
};
const TEST_ID: Record<CustomerField, string> = {
  name: "name",
  contact_name: "contact-name",
  email: "email",
  phone: "phone",
  line1: "line1",
  line2: "line2",
  town: "town",
  county: "county",
  postcode: "postcode",
};

/** The saved value of a field in a 409's `current`, if that field was sent. */
function currentOf(current: CustomerEditableValues | undefined, f: CustomerField): { has: boolean; value: string | null } {
  if (!current) return { has: false, value: null };
  const source = (isAddress(f) ? current.billing_address : current) as Record<string, string | null | undefined> | undefined;
  if (!source || !(f in source)) return { has: false, value: null };
  return { has: true, value: source[f] ?? null };
}

function sent(body: CustomerUpdate | null, f: CustomerField): boolean {
  if (!body) return false;
  return isAddress(f) ? body.billing_address !== undefined && f in body.billing_address : f in body;
}

/**
 * Edit a customer's contact details. Same behaviour as the report form: the record the form started
 * from is kept (its version is what is sent), a 409 keeps the typed values, and "Apply my changes on
 * top" merges them onto the latest version without saving anything.
 */
export function EditCustomerForm({
  customer,
  onSaved,
  onClose,
  onReload,
}: {
  customer: CustomerRecord;
  /** `refetch` is true when the save is only known from a 409, so the cache does not hold it yet. */
  onSaved: (refetch: boolean) => void;
  onClose: () => void;
  /** Loads the latest customer and restarts the form from it. Rejects if it cannot be loaded. */
  onReload: () => Promise<void>;
}) {
  const [original, setOriginal] = useState(customer);
  const [form, setForm] = useState<CustomerFormValues>(() => formFromCustomer(customer));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastBody, setLastBody] = useState<CustomerUpdate | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "reload" | null>(null);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const mutation = useUpdateCustomer(original.id);
  const fetchLatest = useFetchLatestCustomer(original.id);
  const mergeFlow = useMergeOnTop({
    adapter: customerMergeAdapter,
    original,
    form,
    setForm,
    setOriginal,
    fetchLatest,
    toForm: formFromCustomer,
  });
  const { merge } = mergeFlow;
  const me = useMe();
  const idBase = useId();
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const update = buildCustomerUpdate(original, form);
  const problems = validateCustomerForm(form);
  const dirty = update !== null;
  const blocker = useUnsavedChangesGuard(dirty);
  const canSave = dirty && !hasCustomerProblems(problems) && !mutation.isPending && mergeFlow.unresolved === 0;
  const nothingLeft = merge !== null && mergeFlow.unresolved === 0 && !dirty;

  const conflict = failure?.kind === "conflict" ? failure.conflict : null;
  const serverFields = failure?.kind === "fields" ? failure.fields : null;

  const mergeSeq = merge?.seq;
  useEffect(() => {
    if (mergeSeq === undefined) return;
    const target =
      formRef.current?.querySelector<HTMLElement>("[data-clash]") ??
      formRef.current?.querySelector<HTMLElement>("[data-merge-focus]");
    target?.focus();
  }, [mergeSeq]);

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
        const found = parseCustomerConflict(error);
        if (found) {
          // A retry of a request that really succeeded: our own change is what is saved now.
          if (found.lastChangedBy?.id !== undefined && found.lastChangedBy.id === me.data?.id && customerCurrentMatchesUpdate(found.current, body)) {
            onSaved(true);
            return;
          }
          setFailure({ kind: "conflict", conflict: found });
        } else if (error instanceof ApiError && error.status === 422) {
          const fields = new Map<string, string>();
          const general: string[] = [];
          for (const e of error.fieldErrors) {
            const [, first, second] = e.loc;
            const key = first === "billing_address" ? second : first;
            if (typeof key === "string" && (CUSTOMER_FIELDS as readonly string[]).includes(key)) fields.set(key, e.message);
            else general.push(e.message);
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
    if (await mergeFlow.apply()) {
      setFailure(null);
      setLastBody(null);
    }
  }

  function cancel() {
    if (dirty) setConfirm("cancel");
    else onClose();
  }

  function field(f: CustomerField): ReactNode {
    const id = `${idBase}-${f}`;
    const key = mergeKey(f);
    const testId = TEST_ID[f];
    const problem = problems[f] ?? serverFields?.get(f);
    const max = FIELD_MAX[f];
    const clash = mergeFlow.clashFor(key);
    const now = currentOf(conflict?.current, f);
    const showCurrent = conflict !== null && sent(lastBody, f) && now.has;
    return (
      <div className="field" key={f} data-testid={`field-${testId}`}>
        <div className="label-row">
          <label htmlFor={id}>{CUSTOMER_FIELD_LABELS[f]}</label>
          {mergeFlow.reapplied(key) && <ReappliedTag />}
        </div>
        {clash && merge && (
          <ClashChoice
            clash={clash}
            by={merge.by}
            choice={merge.choices[key]}
            onChoose={(c) => mergeFlow.choose(key, c)}
            testId={`${testId}-clash`}
          />
        )}
        <input
          id={id}
          type={INPUT[f].type}
          inputMode={INPUT[f].inputMode}
          value={form[f]}
          // Someone else's data: never offer the browser's autofill suggestions.
          autoComplete="off"
          readOnly={mergeFlow.locked(key)}
          data-testid={`${testId}-input`}
          aria-invalid={problem ? "true" : undefined}
          aria-describedby={`${id}-meta`}
          onChange={(e) => setForm((v) => ({ ...v, [f]: e.target.value }))}
        />
        <div className="field-meta" id={`${id}-meta`}>
          <span className="field-error" data-testid={`${testId}-error`}>
            {problem}
          </span>
          {max !== undefined && (
            <span className="muted small" data-testid={`${testId}-count`}>
              {trimmedLength(form[f]).toLocaleString("en-GB")} / {max.toLocaleString("en-GB")}
            </span>
          )}
        </div>
        {showCurrent && (
          <div className="current-value" data-testid={`${testId}-current`}>
            <span className="current-value-label">Current saved value:</span>
            <span className="prewrap">{now.value === null || now.value === "" ? "(empty)" : now.value}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <form
        ref={formRef}
        className="panel panel-wide edit-form customer-form"
        aria-labelledby={`${idBase}-heading`}
        onSubmit={submit}
        noValidate
        data-testid="edit-customer-form"
      >
        <h2 id={`${idBase}-heading`}>Edit customer details</h2>

        <p role="status" className="notice" data-testid="impact-notice">
          {impactNotice(original.impact)}
        </p>

        {merge && <MergeNotice by={merge.by} at={merge.at} />}
        {nothingLeft && <NothingLeftNotice />}

        {conflict && (
          <div role="alert" className="alert edit-alert" data-testid="edit-conflict">
            <p>
              {conflict.lastChangedBy
                ? `${conflict.lastChangedBy.name} changed this customer${
                    conflict.lastChangedAt ? ` at ${formatTime(conflict.lastChangedAt)}` : ""
                  }.`
                : "Someone else changed this customer."}{" "}
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
                {mergeFlow.applyFailed ? (
                  <button type="button" className="btn btn-small" onClick={() => void applyOnTop()} data-testid="apply-retry">
                    Try again
                  </button>
                ) : (
                  "Try again."
                )}
              </p>
            )}
          </div>
        )}
        {failure?.kind === "forbidden" && (
          <p role="alert" className="alert edit-alert" data-testid="edit-forbidden">
            You no longer have permission to edit this customer.
          </p>
        )}
        {failure?.kind === "retry" && (
          <div role="alert" className="alert edit-alert" data-testid="edit-failure">
            <p>
              Could not save your changes. {failure.network ? "Can't reach the server." : "Something went wrong."} Nothing was lost.
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

        <div className="form-grid">
          {field("name")}
          {field("contact_name")}
          {field("email")}
          {field("phone")}
        </div>
        <h3>Billing address</h3>
        <div className="form-grid">
          {field("line1")}
          {field("line2")}
          {field("town")}
          {field("county")}
          {field("postcode")}
        </div>

        {mergeFlow.unresolved > 0 && (
          <p className="small muted" id={`${idBase}-hint`} data-testid="clash-hint">
            {CLASH_HINT}
          </p>
        )}
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSave}
            data-testid="save-changes"
            aria-describedby={mergeFlow.unresolved > 0 ? `${idBase}-hint` : undefined}
            aria-busy={mutation.isPending}
          >
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
        <p>You have unsaved changes to this customer.</p>
      </ConfirmDialog>
    </>
  );
}
