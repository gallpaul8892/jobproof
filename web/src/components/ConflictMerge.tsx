import { useId, type ReactNode } from "react";
import { formatTime, type Clash, type Choice, type FlatValue, type PersonRef } from "@jobproof/shared";

/** A value as the manager reads it: booleans as Done / Not done, blank as (empty). */
export function displayValue(value: FlatValue): string {
  if (typeof value === "boolean") return value ? "Done" : "Not done";
  return value.trim() === "" ? "(empty)" : value;
}

export function changedByName(by: PersonRef | null | undefined): string {
  return by?.name ?? "someone else";
}

/** "Your changes were re-applied to the latest version (changed by Sarah Whitfield at 11:40). Check them and save." */
export function MergeNotice({ by, at }: { by: PersonRef | null | undefined; at: string | null | undefined }) {
  const when = at ? ` at ${formatTime(at)}` : "";
  return (
    <p role="status" className="notice merge-notice" tabIndex={-1} data-testid="merge-notice" data-merge-focus>
      Your changes were re-applied to the latest version (changed by {changedByName(by)}
      {when}). Check them and save.
    </p>
  );
}

export function NothingLeftNotice() {
  return (
    <p role="status" className="notice merge-notice" data-testid="merge-nothing-left">
      Nothing left to save: the latest version already has the values you kept.
    </p>
  );
}

/** A text marker (not colour alone) on a field whose value was re-applied on top of the latest version. */
export function ReappliedTag({ id }: { id?: string }) {
  return (
    <span id={id} className="reapplied-tag" data-testid="reapplied-tag">
      Re-applied
    </span>
  );
}

function ValueBox({ id, label, children }: { id: string; label: string; children: string }) {
  return (
    <div id={id} className="clash-value prewrap" role="group" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/**
 * The "Keep mine / Keep theirs" choice for a field both managers changed. A labelled radio group
 * named after the field; no option is preselected, and the values are shown as plain text.
 */
export function ClashChoice({
  clash,
  by,
  choice,
  onChoose,
  testId,
}: {
  clash: Clash;
  by: PersonRef | null | undefined;
  choice: Choice | undefined;
  onChoose: (choice: Choice) => void;
  testId: string;
}) {
  const id = useId();
  const other = changedByName(by);
  const option = (which: Choice, title: string, value: FlatValue, who: string): ReactNode => (
    <div className="clash-option">
      <label className="clash-option-title" htmlFor={`${id}-${which}`}>
        <input
          type="radio"
          id={`${id}-${which}`}
          name={`${id}-choice`}
          value={which}
          checked={choice === which}
          aria-describedby={`${id}-${which}-value`}
          data-testid={`${testId}-${which}`}
          onChange={() => onChoose(which)}
        />
        {title}
      </label>
      <ValueBox id={`${id}-${which}-value`} label={`${who} value`}>
        {displayValue(value)}
      </ValueBox>
    </div>
  );
  return (
    <fieldset className="clash" tabIndex={-1} data-clash data-merge-focus-clash data-testid={testId}>
      <legend>
        {clash.label}: changed by you and by {other}
      </legend>
      {option("mine", "Keep mine", clash.mine, "Your")}
      {option("theirs", "Keep theirs", clash.theirs, `${other}'s`)}
    </fieldset>
  );
}

export const CLASH_HINT = "Choose a version for each field marked as changed by both of you.";
